import type { JobRecord, JobStatus } from '../domain';

// Human-friendly Korean labels for each job status (pure, unit-testable).
export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return '대기 중';
    case 'processing':
      return '처리 중';
    case 'succeeded':
      return '완료 ✅';
    case 'failed':
      return '실패 (다시 시도할 수 있어요)';
  }
}

type UploadResultLike = { status?: unknown };

// One-line reassuring summary of a job. Defensive about missing/garbage result_json.
export function jobSummaryText(job: JobRecord): string {
  if (job.status === 'failed') {
    // Prefer the concrete reason (e.g. "어도비 스톡 업로드 실패 (1/1)") so the
    // photographer knows which agency to check instead of a generic apology.
    const detail = typeof job.error === 'string' ? job.error.trim() : '';
    return detail
      ? `${detail} — '다시 시도'를 눌러주세요.`
      : "처리 중 문제가 발생했어요. '다시 시도'를 눌러주세요.";
  }

  if (job.status === 'succeeded') {
    const results = Array.isArray((job.result as { results?: unknown } | null)?.results)
      ? ((job.result as { results: UploadResultLike[] }).results)
      : [];
    if (results.length > 0) {
      const succeeded = results.filter((r) => r?.status === 'uploaded').length;
      const failed = results.length - succeeded;
      return `${results.length}개 플랫폼에 업로드됨 (성공 ${succeeded}, 실패 ${failed})`;
    }
    return '완료되었어요.';
  }

  if (job.status === 'processing') {
    return '지금 처리하고 있어요. 잠시만 기다려주세요.';
  }

  return '차례를 기다리고 있어요.';
}
