'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { AgencyCredentialRecord, AssetRecord, ContributorProfile, JobRecord, PlatformKey, SubmissionRecord, UserRecord } from '@/lib/domain';
import type { W8BenFields } from '@/lib/tax/w8ben';
import { signIn, signInWithGoogle, signOutClient, signUp } from '@/lib/firebase/client';
import { jobStatusLabel, jobSummaryText } from '@/lib/jobs/status-copy';
import { PLATFORM_PRESETS } from '@/lib/ftp/presets';
import { ONBOARDING_GUIDES } from '@/lib/onboarding-guide';

type AssetWithSubmissions = AssetRecord & { submissions: SubmissionRecord[] };
type SafeCredential = Omit<AgencyCredentialRecord, 'encryptedPassword'>;

type Props = {
  currentUser: UserRecord | null;
  initialAssets: AssetWithSubmissions[];
};

const platforms = [
  { key: 'adobe', label: 'Adobe Stock' },
  { key: 'shutterstock', label: 'Shutterstock' },
  { key: 'alamy', label: 'Alamy' },
  { key: 'getty', label: 'Getty / iStock' },
] as const;

// Platforms with a configured FTP/SFTP endpoint (getty has none yet).
const ftpPlatforms = [
  { key: 'adobe', label: 'Adobe Stock' },
  { key: 'shutterstock', label: 'Shutterstock' },
  { key: 'alamy', label: 'Alamy' },
] as const;

async function fetchAssets() {
  const response = await fetch('/api/assets', { cache: 'no-store' });
  if (!response.ok) throw new Error('자산 목록을 불러오지 못했습니다.');
  const data = await response.json();
  return data.assets as AssetWithSubmissions[];
}

type UploadFields = { title?: string; description?: string; keywords?: string[]; releaseStatus?: string };

// Vercel Functions cap a request body at 4.5MB — real camera photos routinely
// exceed that. When the server backend supports it (production/firebase), this
// PUTs bytes straight from the browser to storage and only sends small JSON
// through our API; that upload-url handshake also tells us it's not supported
// (e.g. local dev on sqlite/local-fs) so we fall back to the original
// single-request proxy path, which has no such size ceiling locally.
async function uploadAsset(file: File, fields: UploadFields = {}): Promise<AssetRecord> {
  const initRes = await fetch('/api/assets/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || '업로드 준비 실패');

  if (!initData.direct) {
    const formData = new FormData();
    formData.append('file', file);
    if (fields.title) formData.append('title', fields.title);
    if (fields.description) formData.append('description', fields.description);
    if (fields.keywords) formData.append('keywords', fields.keywords.join(','));
    if (fields.releaseStatus) formData.append('releaseStatus', fields.releaseStatus);
    const response = await fetch('/api/assets/upload', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '업로드 실패');
    return data.asset as AssetRecord;
  }

  const putRes = await fetch(initData.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error('파일 전송 실패 (네트워크 상태를 확인해주세요)');

  const finalizeRes = await fetch('/api/assets/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath: initData.storagePath,
      originalFilename: file.name,
      mimeType: file.type || 'application/octet-stream',
      ...fields,
    }),
  });
  const finalizeData = await finalizeRes.json();
  if (!finalizeRes.ok) throw new Error(finalizeData.error || '업로드 등록 실패');
  return finalizeData.asset as AssetRecord;
}

export function StockDashboardClient({ currentUser, initialAssets }: Props) {
  const [user, setUser] = useState(currentUser);
  const [assets, setAssets] = useState(initialAssets);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [w8ben, setW8ben] = useState<W8BenFields | null>(null);
  const [credentials, setCredentials] = useState<SafeCredential[]>([]);
  const [credPlatform, setCredPlatform] = useState<PlatformKey>('adobe');
  const [copiedLabel, setCopiedLabel] = useState('');
  const [isPending, startTransition] = useTransition();

  // 간편 자동 업로드 (배치 파이프라인) 상태
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchPlatforms, setBatchPlatforms] = useState<PlatformKey[]>([]);
  const [batchStatus, setBatchStatus] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 처리 현황 (최근 작업 목록)
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  async function refreshJobs() {
    if (!user) return;
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    setJobs((data.jobs as JobRecord[]).slice(0, 20));
  }

  async function handleRetryJob(jobId: string) {
    if (retryingJobId) return;
    setRetryingJobId(jobId);
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      if (!response.ok) return;
      await fetch('/api/jobs/tick', { method: 'POST' });
      await refreshJobs();
    } finally {
      setRetryingJobId(null);
    }
  }

  // 로그인한 사용자가 자격증명을 가진 플랫폼을 기본 선택으로 채운다.
  useEffect(() => {
    const owned = Array.from(new Set(credentials.map((c) => c.platform)));
    setBatchPlatforms(owned);
  }, [credentials]);

  // 언마운트 시 폴링 타이머 정리 (타이머 누수 방지).
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  async function refresh() {
    if (!user) return;
    const nextAssets = await fetchAssets();
    setAssets(nextAssets);
  }

  async function loadOnboarding() {
    const [profileRes, credsRes] = await Promise.all([
      fetch('/api/profile', { cache: 'no-store' }),
      fetch('/api/credentials', { cache: 'no-store' }),
    ]);
    if (profileRes.ok) {
      const data = await profileRes.json();
      setProfile(data.profile);
      if (data.profile) {
        const w8Res = await fetch('/api/profile/w8ben', { cache: 'no-store' });
        setW8ben(w8Res.ok ? (await w8Res.json()).w8ben : null);
      }
    }
    if (credsRes.ok) setCredentials((await credsRes.json()).credentials);
  }

  useEffect(() => {
    if (user) {
      void loadOnboarding();
      void refreshJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const payload = {
      legalNameFull: String(f.get('legalNameFull') || ''),
      displayName: String(f.get('displayName') || ''),
      country: String(f.get('country') || 'KR'),
      phone: String(f.get('phone') || ''),
      address: {
        line1: String(f.get('line1') || ''),
        line2: String(f.get('line2') || ''),
        city: String(f.get('city') || ''),
        region: String(f.get('region') || ''),
        postalCode: String(f.get('postalCode') || ''),
        country: String(f.get('addressCountry') || ''),
      },
      tax: { foreignTin: String(f.get('foreignTin') || ''), usTin: String(f.get('usTin') || '') },
      payment: { method: String(f.get('method') || ''), payoutEmail: String(f.get('payoutEmail') || '') },
    };
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || '프로필 저장 실패');
      return;
    }
    await loadOnboarding();
    setMessage('프로필 저장 완료');
  }

  async function handleCredentialSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const payload = {
      platform: String(f.get('platform') || ''),
      protocol: String(f.get('protocol') || ''),
      host: String(f.get('host') || ''),
      port: Number(f.get('port') || 0),
      username: String(f.get('username') || ''),
      password: String(f.get('password') || ''),
    };
    const response = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || '자격증명 저장 실패');
      return;
    }
    form.reset();
    await loadOnboarding();
    setMessage('FTP 자격증명 저장 완료');
  }

  function handleUploadFtp(assetId: string, form: HTMLFormElement) {
    const selected = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="platform"]:checked')).map((el) => el.value);
    if (selected.length === 0) {
      setMessage('업로드할 플랫폼을 하나 이상 선택하세요.');
      return;
    }
    startTransition(async () => {
      setMessage('에이전시 업로드 중...');
      const response = await fetch(`/api/assets/${assetId}/upload-ftp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: selected }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || '에이전시 업로드 실패');
        return;
      }
      await refresh();
      const summary = (data.results as { platform: string; status: string }[]).map((r) => `${r.platform}:${r.status}`).join(', ');
      setMessage(`업로드 결과 — ${summary}`);
    });
  }

  async function establishSession(idToken: string, name?: string): Promise<boolean> {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, name }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || '인증 실패');
      return false;
    }
    setUser(data.user);
    const nextAssets = await fetchAssets();
    setAssets(nextAssets);
    return true;
  }

  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const email = String(f.get('email') || '');
    const password = String(f.get('password') || '');
    const name = String(f.get('name') || '');
    try {
      const idToken = mode === 'register' ? await signUp(email, password) : await signIn(email, password);
      const ok = await establishSession(idToken, name);
      if (!ok) return;
      setMessage(mode === 'register' ? '가입 및 로그인 완료' : '로그인 완료');
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '인증 실패');
    }
  }

  async function handleGoogleLogin() {
    try {
      const idToken = await signInWithGoogle();
      const ok = await establishSession(idToken);
      if (ok) setMessage('로그인 완료');
    } catch {
      setMessage('Google 로그인 취소 또는 실패');
    }
  }

  async function handleLogout() {
    await signOutClient().catch(() => {});
    await fetch('/api/auth/session', { method: 'DELETE' });
    setUser(null);
    setAssets([]);
    setMessage('로그아웃되었습니다.');
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setMessage('파일을 선택해주세요.');
      return;
    }
    setMessage('업로드 중...');
    try {
      await uploadAsset(file, {
        title: String(formData.get('title') || ''),
        description: String(formData.get('description') || ''),
        keywords: String(formData.get('keywords') || '').split(',').map((k) => k.trim()).filter(Boolean),
        releaseStatus: String(formData.get('releaseStatus') || 'none'),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드 실패');
      return;
    }
    form.reset();
    await refresh();
    setMessage('업로드 완료');
  }

  async function handleCopy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(''), 1500);
    } catch {
      setMessage('복사에 실패했습니다. 직접 선택해서 복사해 주세요.');
    }
  }

  function toggleBatchPlatform(key: PlatformKey) {
    setBatchPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  async function handleBatchStart() {
    if (batchRunning) return;
    if (batchFiles.length === 0) {
      setBatchStatus('먼저 사진이나 영상 파일을 선택하세요.');
      return;
    }
    if (batchPlatforms.length === 0) {
      setBatchStatus('업로드할 플랫폼을 하나 이상 선택하세요.');
      return;
    }

    setBatchRunning(true);
    try {
      // 1) 파일을 하나씩 업로드하고 asset id를 모은다.
      const assetIds: string[] = [];
      for (let i = 0; i < batchFiles.length; i += 1) {
        setBatchStatus(`업로드 중 (${i + 1}/${batchFiles.length})…`);
        try {
          const asset = await uploadAsset(batchFiles[i]);
          assetIds.push(asset.id);
        } catch (error) {
          setBatchStatus(error instanceof Error ? error.message : '업로드 실패');
          setBatchRunning(false);
          return;
        }
      }

      // 2) 파이프라인 시작 (메타데이터 자동 생성 + 에이전시 업로드).
      setBatchStatus('자동 처리를 시작하는 중…');
      const startRes = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds, platforms: batchPlatforms, generateMetadata: true }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) {
        setBatchStatus(startData.error || '자동 처리 시작 실패');
        setBatchRunning(false);
        return;
      }
      const jobIds = new Set<string>(startData.jobIds as string[]);
      const total = jobIds.size;

      // 3) 큐를 구동(tick)하며 상태를 폴링한다.
      let polls = 0;
      const maxPolls = 60;
      pollTimerRef.current = setInterval(async () => {
        polls += 1;
        try {
          await fetch('/api/jobs/tick', { method: 'POST' });
          const jobsRes = await fetch('/api/jobs', { cache: 'no-store' });
          const jobsData = await jobsRes.json();
          const mine = (jobsData.jobs as JobRecord[]).filter((j) => jobIds.has(j.id));
          const succeeded = mine.filter((j) => j.status === 'succeeded').length;
          const failed = mine.filter((j) => j.status === 'failed').length;
          const active = mine.filter((j) => j.status === 'pending' || j.status === 'processing').length;
          setBatchStatus(`처리 완료 ${succeeded} / 진행중 ${active} / 실패 ${failed}`);

          if (active === 0 || polls >= maxPolls) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            await refresh();
            await refreshJobs();
            setBatchRunning(false);
            if (active === 0) {
              const tail = failed > 0 ? ' — 실패한 사진은 다시 시도할 수 있습니다.' : '';
              setBatchStatus(`완료! 사진 ${total}장 처리됨 (성공 ${succeeded}, 실패 ${failed})${tail}`);
            } else {
              setBatchStatus(`처리가 오래 걸립니다. 잠시 후 새로고침 하세요. (완료 ${succeeded} / 진행중 ${active} / 실패 ${failed})`);
            }
          }
        } catch {
          // 일시적 네트워크 오류는 다음 폴링에서 다시 시도한다.
        }
      }, 2000);
    } catch (error) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      setBatchStatus(error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.');
      setBatchRunning(false);
    }
  }

  function handleExport(assetId: string, platform: string) {
    startTransition(async () => {
      setMessage(`${platform} 패키지 생성 중...`);
      const response = await fetch(`/api/assets/${assetId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || `${platform} 패키지 생성 실패`);
        return;
      }
      await refresh();
      setMessage(`${platform} 패키지 생성 완료`);
      window.location.href = data.downloadUrl;
    });
  }

  if (!user) {
    return (
      <section className="card section auth-shell">
        <div className="dashboard-header">
          <div>
            <h2>로그인 / 회원가입</h2>
            <p className="lead compact">사용자별 자산을 분리하려면 먼저 계정이 필요합니다.</p>
          </div>
          <div className="auth-mode-switch">
            <button type="button" className={`button ${mode === 'register' ? 'primary' : ''}`} onClick={() => setMode('register')}>
              회원가입
            </button>
            <button type="button" className={`button ${mode === 'login' ? 'primary' : ''}`} onClick={() => setMode('login')}>
              로그인
            </button>
          </div>
        </div>
        <form className="upload-form" onSubmit={(event) => void handleAuth(event)}>
          {mode === 'register' ? (
            <label>
              이름
              <input name="name" type="text" required minLength={2} />
            </label>
          ) : null}
          <label>
            이메일
            <input name="email" type="email" required />
          </label>
          <label>
            비밀번호
            <input name="password" type="password" required minLength={8} />
          </label>
          <button type="submit" className="button primary">
            {mode === 'register' ? '회원가입 후 시작' : '로그인'}
          </button>
        </form>
        <p className="lead compact" style={{ textAlign: 'center', margin: '12px 0' }}>또는</p>
        <button
          type="button"
          className="button primary batch-button"
          onClick={() => void handleGoogleLogin()}
        >
          Google로 로그인
        </button>
        {message ? <p className="status-note">{message}</p> : null}
      </section>
    );
  }

  const copyFields = profile
    ? [
        { label: '영문 이름', value: profile.identity.legalNameFull },
        { label: '주소 1', value: profile.address.line1 },
        { label: '주소 2', value: profile.address.line2 },
        { label: '도시', value: profile.address.city },
        { label: '지역/시도', value: profile.address.region },
        { label: '국가', value: profile.address.country },
        { label: '전화번호', value: profile.identity.phone },
      ].filter((f) => f.value && f.value.trim().length > 0)
    : [];

  return (
    <section className="card section">
      <div className="dashboard-header">
        <div>
          <h2>실제 업로드 / 어댑터 대시보드</h2>
          <p className="lead compact">{user.name}님 계정으로 로그인됨 · 사용자별 자산이 분리 저장됩니다.</p>
        </div>
        <div className="auth-mode-switch">
          <button type="button" className="button" onClick={() => void refresh()}>새로고침</button>
          <button type="button" className="button" onClick={() => void handleLogout()}>로그아웃</button>
        </div>
      </div>

      <div className="card batch-card">
        <h2 className="batch-title">간편 자동 업로드</h2>
        <p className="batch-guide">
          사진(또는 영상)을 여러 장 고르고, 아래 큰 버튼을 한 번만 누르세요.
          제목·키워드는 자동으로 만들어지고 선택한 곳에 알아서 올려드립니다.
        </p>

        <label className="batch-field">
          <span className="batch-label">1. 사진 고르기 (여러 장 선택 가능)</span>
          <input
            ref={batchFileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            disabled={batchRunning}
            onChange={(event) => setBatchFiles(Array.from(event.currentTarget.files ?? []))}
          />
        </label>
        {batchFiles.length > 0 ? <p className="batch-guide">선택한 파일 {batchFiles.length}장</p> : null}

        <div className="batch-field">
          <span className="batch-label">2. 올릴 곳 고르기</span>
          {credentials.length === 0 ? (
            <p className="batch-hint">먼저 아래에서 업로드 계정을 등록하세요.</p>
          ) : (
            <div className="batch-platforms">
              {platforms.map((platform) => (
                <label key={platform.key} className="batch-check">
                  <input
                    type="checkbox"
                    checked={batchPlatforms.includes(platform.key)}
                    disabled={batchRunning}
                    onChange={() => toggleBatchPlatform(platform.key)}
                  />
                  {platform.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="button primary batch-button" disabled={batchRunning} onClick={() => void handleBatchStart()}>
          {batchRunning ? '처리 중…' : '업로드하고 자동으로 처리 시작'}
        </button>
        {batchStatus ? <p className="batch-status">{batchStatus}</p> : null}
      </div>

      <div className="card batch-card">
        <div className="dashboard-header">
          <h2 className="batch-title">처리 현황</h2>
          <button type="button" className="button" onClick={() => void refreshJobs()}>새로고침</button>
        </div>
        {jobs.length === 0 ? (
          <p className="batch-guide">아직 처리한 작업이 없습니다. 위에서 사진을 올려보세요.</p>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => (
              <li key={job.id} className="job-item">
                <div className="job-status">{jobStatusLabel(job.status)}</div>
                <p className="job-summary">{jobSummaryText(job)}</p>
                <p className="job-time">{new Date(job.createdAt).toLocaleString('ko-KR')}</p>
                {job.status === 'failed' ? (
                  <button
                    type="button"
                    className="button primary"
                    disabled={retryingJobId === job.id}
                    onClick={() => void handleRetryJob(job.id)}
                  >
                    {retryingJobId === job.id ? '다시 시도하는 중…' : '다시 시도'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="upload-form" onSubmit={(event) => void handleUpload(event)}>
        <label>
          이미지 파일
          <input name="file" type="file" accept="image/*" required />
        </label>
        <label>
          제목
          <input name="title" type="text" placeholder="예: Bright classroom reading scene" />
        </label>
        <label>
          설명
          <textarea name="description" rows={3} placeholder="사진 설명" />
        </label>
        <label>
          키워드
          <input name="keywords" type="text" placeholder="children, education, library" />
        </label>
        <label>
          릴리스 상태
          <select name="releaseStatus" defaultValue="none">
            <option value="none">없음 (editorial)</option>
            <option value="model_attached">모델 릴리스 첨부</option>
            <option value="property_attached">프로퍼티 릴리스 첨부</option>
            <option value="both_attached">둘 다 첨부</option>
          </select>
        </label>
        <button type="submit" className="button primary" disabled={isPending}>파일 저장</button>
      </form>

      {message ? <p className="status-note">{message}</p> : null}

      <div className="section">
        <h3>온보딩 — 마스터 프로필</h3>
        <p className="cred-help">⚠️ 아래 이름·주소는 해외 스톡 사이트 등록과 세금서류(W-8BEN)에 그대로 사용됩니다. <strong>반드시 영문(로마자)으로 입력하세요.</strong> (예: 이창준 → Changjun Lee)</p>
        <form className="upload-form" onSubmit={(event) => void handleProfileSave(event)}>
          <label>법적 이름 (영문 전체)<input name="legalNameFull" type="text" required placeholder="예: Changjun Lee" defaultValue={profile?.identity.legalNameFull ?? ''} /></label>
          <label>표시 이름 (영문)<input name="displayName" type="text" required placeholder="예: Changjun Lee" defaultValue={profile?.identity.displayName ?? ''} /></label>
          <label>국가 코드<input name="country" type="text" placeholder="예: KR" defaultValue={profile?.identity.country ?? 'KR'} /></label>
          <label>전화번호<input name="phone" type="text" placeholder="예: +82 10 4374 6009" defaultValue={profile?.identity.phone ?? ''} /></label>
          <label>주소 1 (영문 도로명)<input name="line1" type="text" placeholder="예: 50, Daejong-ro 199beon-gil" defaultValue={profile?.address.line1 ?? ''} /></label>
          <label>주소 2 (영문 상세)<input name="line2" type="text" placeholder="예: Unit 301" defaultValue={profile?.address.line2 ?? ''} /></label>
          <label>도시 (영문)<input name="city" type="text" placeholder="예: Jung-gu" defaultValue={profile?.address.city ?? ''} /></label>
          <label>지역/시도 (영문)<input name="region" type="text" placeholder="예: Daejeon" defaultValue={profile?.address.region ?? ''} /></label>
          <label>우편번호<input name="postalCode" type="text" defaultValue={profile?.address.postalCode ?? ''} /></label>
          <label>주소 국가<input name="addressCountry" type="text" defaultValue={profile?.address.country ?? 'KR'} /></label>
          <label>Foreign TIN (해외 납세자번호)<input name="foreignTin" type="text" defaultValue={profile?.tax.foreignTin ?? ''} /></label>
          <label>US TIN<input name="usTin" type="text" defaultValue={profile?.tax.usTin ?? ''} /></label>
          <label>지급 방식<input name="method" type="text" placeholder="paypal / bank" defaultValue={profile?.payment.method ?? ''} /></label>
          <label>지급 이메일<input name="payoutEmail" type="text" defaultValue={profile?.payment.payoutEmail ?? ''} /></label>
          <button type="submit" className="button primary">프로필 저장</button>
        </form>
        {w8ben ? (
          <div className="submission-log">
            <strong>W-8BEN 자동 채움 (미리보기)</strong>
            <ul className="meta-list">
              <li>이름: {w8ben.name}</li>
              <li>시민권 국가: {w8ben.countryOfCitizenship}</li>
              <li>영구 주소: {w8ben.permanentAddress || '없음'}</li>
              <li>Foreign TIN: {w8ben.foreignTin || '없음'}</li>
              <li>조약 국가: {w8ben.treatyCountry || '없음'}</li>
              <li>조약 조항: {w8ben.treatyArticle || '없음'}</li>
              <li>원천징수율: {w8ben.withholdingRate}%</li>
              <li>소득 유형: {w8ben.incomeType || '없음'}</li>
            </ul>
            {w8ben.warnings.length > 0 ? (
              <ul className="meta-list">
                {w8ben.warnings.map((warning) => (
                  <li key={warning}>⚠️ {warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="section">
        <h3>사이트별 등록 안내</h3>
        <p className="cred-help">
          아래 사이트들은 <strong>처음 한 번</strong> 직접 가입·설정해야 합니다. 앱이 계정을 대신 만들어주지 않습니다.
          순서대로 따라 하시고, 마지막에 발급받은 아이디·비밀번호를 아래 "업로드 계정 연결"에 저장하면 그다음부터는 앱이 자동으로 올려드립니다.
        </p>

        {copyFields.length > 0 ? (
          <div className="guide-copy">
            <p className="batch-label">내 영문 정보 복사 (가입 폼에 붙여넣기)</p>
            <div className="guide-copy-buttons">
              {copyFields.map((field) => (
                <button
                  key={field.label}
                  type="button"
                  className="button guide-copy-chip"
                  onClick={() => void handleCopy(field.label, field.value)}
                >
                  {copiedLabel === field.label ? `✅ ${field.label} 복사됨` : `${field.label} 복사`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="batch-hint">먼저 위 "마스터 프로필"에 영문 이름·주소를 저장하면, 여기서 복사 버튼으로 각 사이트 가입 폼에 붙여넣을 수 있어요.</p>
        )}

        {PLATFORM_PRESETS.filter((preset) => preset.available).map((preset) => {
          const guide = ONBOARDING_GUIDES[preset.key];
          if (!preset.available || !guide) return null;
          const connected = credentials.some((c) => c.platform === preset.key);
          return (
            <div key={preset.key} className="guide-agency">
              <div className="guide-agency-head">
                <h4 className="guide-agency-name">{preset.label}</h4>
                <span className={`guide-badge ${connected ? 'ok' : 'todo'}`}>
                  {connected ? '✅ 연결됨' : '⚠️ 등록 필요'}
                </span>
              </div>
              <ol className="guide-steps">
                {guide.steps.map((step) => (
                  <li key={step.instruction} className="guide-step">
                    <span className="guide-step-text">{step.instruction}</span>
                    {step.link ? (
                      <a className="cred-link" href={step.link.href} target="_blank" rel="noreferrer">
                        {step.link.label} →
                      </a>
                    ) : null}
                    {step.note ? <span className="guide-step-note">{step.note}</span> : null}
                  </li>
                ))}
              </ol>
              <p className="cred-auto-note">
                FTP 접속정보: {preset.host} · {preset.protocol.toUpperCase()} 포트 {preset.port} — 아래 "업로드 계정 연결"에서 아이디·비밀번호만 저장하세요.
              </p>
            </div>
          );
        })}

        {PLATFORM_PRESETS.filter((preset) => !preset.available).map((preset) => (
          <div key={preset.key} className="guide-agency">
            <div className="guide-agency-head">
              <h4 className="guide-agency-name">{preset.label}</h4>
              <span className="guide-badge todo">현재 자동 업로드 미지원</span>
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <h3>업로드 계정 연결</h3>
        <p className="batch-guide">
          올릴 곳을 고르고, 그곳에서 받은 아이디와 비밀번호만 입력하면 됩니다.
          서버 주소는 자동으로 채워지니 따로 입력하지 않으셔도 돼요.
        </p>

        <div className="cred-platform-picker">
          {PLATFORM_PRESETS.map((preset) => {
            const connected = credentials.some((c) => c.platform === preset.key);
            return (
              <button
                key={preset.key}
                type="button"
                className={`button cred-platform-chip ${credPlatform === preset.key ? 'primary' : ''}`}
                onClick={() => setCredPlatform(preset.key)}
              >
                {preset.label}{connected ? ' ✅' : ''}
              </button>
            );
          })}
        </div>

        {PLATFORM_PRESETS.filter((preset) => preset.key === credPlatform).map((preset) =>
          preset.available ? (
            <div key={preset.key}>
              <p className="cred-help">{preset.helpText}</p>
              <a className="cred-link" href={preset.signupUrl} target="_blank" rel="noreferrer">
                가입/자격증명 확인하기 →
              </a>
              <form className="upload-form" onSubmit={(event) => void handleCredentialSave(event)}>
                <input type="hidden" name="platform" value={preset.key} />
                <input type="hidden" name="protocol" value={preset.protocol} />
                <input type="hidden" name="host" value={preset.host} />
                <input type="hidden" name="port" value={preset.port} />
                <label>사용자명 (아이디)<input name="username" type="text" required /></label>
                <label>비밀번호<input name="password" type="password" required /></label>
                <button type="submit" className="button primary">이 계정으로 저장</button>
              </form>
              <p className="cred-auto-note">
                서버 주소: {preset.host} · {preset.protocol.toUpperCase()} 포트 {preset.port} (자동 입력됨)
              </p>
            </div>
          ) : (
            <p key={preset.key} className="batch-hint">현재 자동 업로드를 지원하지 않아요.</p>
          ),
        )}

        {credentials.length > 0 ? (
          <>
            <p className="batch-label">연결된 계정</p>
            <ul className="meta-list">
              {credentials.map((credential) => (
                <li key={credential.id}>✅ {credential.platform} · {credential.username}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="asset-grid">
        {assets.length === 0 ? (
          <div className="empty-state">아직 업로드된 자산이 없습니다.</div>
        ) : (
          assets.map((asset) => (
            <article key={asset.id} className="asset-card">
              <div className="asset-meta">
                <h3>{asset.title}</h3>
                <p>{asset.description || '설명 없음'}</p>
                <ul className="meta-list">
                  <li>파일: {asset.originalFilename}</li>
                  <li>저장: {asset.storageBackend}</li>
                  <li>크기: {asset.width ?? '?'} × {asset.height ?? '?'}</li>
                  <li>릴리스: {asset.releaseStatus}</li>
                  <li>키워드: {asset.keywords.join(', ') || '없음'}</li>
                </ul>
              </div>
              <div className="adapter-actions">
                {platforms.map((platform) => (
                  <button key={platform.key} type="button" className="button" disabled={isPending} onClick={() => handleExport(asset.id, platform.key)}>
                    {platform.label} 패키지 생성
                  </button>
                ))}
              </div>
              <form
                className="adapter-actions"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleUploadFtp(asset.id, event.currentTarget);
                }}
              >
                {ftpPlatforms.map((platform) => (
                  <label key={platform.key}>
                    <input type="checkbox" name="platform" value={platform.key} /> {platform.label}
                  </label>
                ))}
                <button type="submit" className="button primary" disabled={isPending}>에이전시로 업로드</button>
              </form>
              <div className="submission-log">
                <strong>최근 생성 패키지</strong>
                {asset.submissions.length === 0 ? (
                  <p>아직 생성된 제출 패키지가 없습니다.</p>
                ) : (
                  <ul className="meta-list">
                    {asset.submissions.slice(0, 4).map((submission) => (
                      <li key={submission.id}>
                        {submission.platform} · {submission.status} · {submission.exportBackend} · {new Date(submission.createdAt).toLocaleString('ko-KR')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
