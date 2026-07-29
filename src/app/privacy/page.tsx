import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보처리방침 · StockFlow OS',
};

export default function PrivacyPage() {
  return (
    <article className="card markdown-page">
      <div className="manual-header">
        <span className="eyebrow">개인정보처리방침</span>
        <h1>개인정보처리방침</h1>
        <p>StockFlow OS가 수집·이용하는 개인정보에 관한 안내입니다.</p>
      </div>
      <div className="markdown-body">
        <blockquote>
          본 방침은 예시 템플릿이며 정식 서비스 전 법률 검토가 필요합니다.
        </blockquote>

        <h2>1. 수집하는 개인정보 항목</h2>
        <ul>
          <li>계정 정보: 이메일, 이름 (Firebase 인증을 통해 수집)</li>
          <li>
            컨트리뷰터 프로필: 법적 이름, 주소, 전화번호, 세금 정보(W-8BEN 작성을 위한
            납세자번호 등), 지급 정보
          </li>
          <li>
            에이전시 FTP 자격증명: 각 에이전시의 아이디·비밀번호. 비밀번호는 저장 시
            AES-256-GCM 방식으로 암호화되어 보관됩니다.
          </li>
          <li>업로드한 사진·영상 등 미디어 파일 및 메타데이터</li>
        </ul>

        <h2>2. 개인정보의 이용 목적</h2>
        <ul>
          <li>회원 식별 및 계정 관리</li>
          <li>이용자를 대신한 스톡 에이전시 업로드 대행</li>
          <li>세금 서식(W-8BEN 등) 자동 작성 보조</li>
          <li>사진·영상 메타데이터(제목·키워드) 자동 생성</li>
        </ul>

        <h2>3. 제3자 제공 및 처리 위탁</h2>
        <ul>
          <li>
            업로드 대행: 이용자가 설정한 스톡 에이전시(Adobe Stock, Shutterstock, Alamy 등)에
            콘텐츠와 메타데이터가 전송됩니다.
          </li>
          <li>
            AI 메타데이터 생성: 제목·키워드 자동 생성을 위해 미디어와 관련 힌트가
            Gemini 및 OpenRouter 등 AI 제공자에게 전송될 수 있습니다.
          </li>
        </ul>

        <h2>4. 보유 및 이용 기간</h2>
        <p>
          개인정보는 서비스 이용 기간 동안 보유하며, 이용자가 삭제를 요청하거나 회원 탈퇴 시
          관련 법령에서 정한 경우를 제외하고 지체 없이 파기합니다.
        </p>

        <h2>5. 이용자의 권리</h2>
        <p>
          이용자는 언제든지 본인의 개인정보에 대한 열람, 정정, 삭제를 요청할 수 있습니다.
          요청은 서비스 내 문의 또는 고객센터를 통해 접수할 수 있습니다.
        </p>

        <h2>6. 개인정보의 보호</h2>
        <p>
          에이전시 자격증명의 비밀번호는 AES-256-GCM 방식으로 암호화하여 저장하며,
          접근 권한을 최소화하여 관리합니다.
        </p>
      </div>
    </article>
  );
}
