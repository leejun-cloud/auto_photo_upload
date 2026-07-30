import type { PlatformKey } from './domain';

// 사이트별 "처음 한 번" 직접 등록 안내.
// 앱은 계정을 대신 만들어주지 않는다. 사용자가 각 에이전시에 직접 가입·세금·지급·FTP 설정을 마쳐야
// 그 다음부터 앱이 업로드할 수 있다. 링크는 2026년에 실제로 열리는 것만 넣었다.
export type OnboardingStep = {
  // 어르신도 이해할 수 있는 한국어 한 줄 지시.
  instruction: string;
  // 눌러서 바로 갈 수 있는 검증된 링크 (있을 때만).
  link?: { href: string; label: string };
  // 추가 설명 / 주의.
  note?: string;
};

export type PlatformOnboarding = {
  key: PlatformKey;
  steps: OnboardingStep[];
};

// available 플랫폼(adobe/shutterstock/alamy)만 안내를 가진다. getty는 자동 업로드 미지원이라 없음.
export const ONBOARDING_GUIDES: Partial<Record<PlatformKey, PlatformOnboarding>> = {
  adobe: {
    key: 'adobe',
    steps: [
      {
        instruction: '1. 컨트리뷰터 계정 만들기 — Adobe ID로 로그인한 뒤 컨트리뷰터로 가입하세요.',
        link: { href: 'https://contributor.stock.adobe.com/', label: '어도비 스톡 컨트리뷰터 가입 페이지 열기' },
        note: '아래 마스터 프로필의 영문 이름·주소를 복사해서 붙여넣으면 편해요.',
      },
      {
        instruction: '2. 세금 정보 제출 — 컨트리뷰터 계정의 "세금 정보(Tax information)" 화면에서 W-8BEN을 작성합니다.',
        note: '한국은 미국과 조세조약이 있어 원천징수율을 낮출 수 있어요. 별도 미국 납세자번호(TIN) 없이도 제출 가능합니다.',
      },
      {
        instruction: '3. 지급 수단 연결 — 컨트리뷰터 계정의 "Payouts(지급)" 섹션에서 PayPal / Payoneer / Skrill 중 하나를 연결합니다.',
      },
      {
        instruction: '4. SFTP 자격증명 발급 — 업로드 화면에서 "You can also import files using your SFTP" 옆의 안내를 열고 "Generate password"를 눌러 사용자명과 비밀번호를 받습니다.',
        note: 'SFTP 옵션은 일정 자격을 갖춘 계정에만 보입니다. 비밀번호는 "Generate password"를 누를 때마다 새로 바뀝니다. 접속정보는 sftp.contributor.adobestock.com · SFTP 포트 22 입니다.',
      },
    ],
  },
  shutterstock: {
    key: 'shutterstock',
    steps: [
      {
        instruction: '1. 컨트리뷰터 계정 만들기 — 이메일로 무료 가입합니다.',
        link: {
          href: 'https://submit.shutterstock.com/help/en/articles/10617443-how-do-i-sign-up-to-become-a-shutterstock-contributor',
          label: '셔터스톡 컨트리뷰터 가입 안내 열기',
        },
        note: '이름·주소는 영문으로만 입력해야 합니다. 아래 마스터 프로필 값을 복사해서 쓰세요.',
      },
      {
        instruction: '2. 세금 정보 제출 — 가입 과정 또는 계정의 "Earnings → Tax Form"에서 W-8BEN(비미국 거주자)을 작성합니다.',
        note: '세금 서류를 제출해야 사진 업로드와 지급이 가능합니다.',
      },
      {
        instruction: '3. 지급 수단 연결 — 계정 설정의 지급(payment) 화면에서 PayPal / Skrill / Payoneer 중 하나를 연결합니다.',
        link: {
          href: 'https://submit.shutterstock.com/help/en/articles/12135709-how-do-i-set-up-or-fix-my-earnings-payment-method',
          label: '셔터스톡 지급 수단 설정 안내 열기',
        },
      },
      {
        instruction: '4. FTPS 접속정보 확인 — 셔터스톡은 별도 FTP 비밀번호를 발급하지 않습니다. 컨트리뷰터 이메일(또는 사용자명)과 로그인 비밀번호를 그대로 사용합니다.',
        link: {
          href: 'https://submit.shutterstock.com/help/en/articles/10617392-how-do-i-upload-content-via-ftps',
          label: '셔터스톡 FTPS 업로드 안내 열기',
        },
        note: '접속정보는 ftps.shutterstock.com · FTPS(명시적 TLS) 포트 21 입니다.',
      },
    ],
  },
  alamy: {
    key: 'alamy',
    steps: [
      {
        instruction: '1. 컨트리뷰터 계정 만들기 — 알라미 컨트리뷰터로 가입합니다.',
        link: { href: 'https://www.alamy.com/contributor/', label: '알라미 컨트리뷰터 가입 페이지 열기' },
        note: '만 18세 이상이면 누구나 가입할 수 있어요. 아래 마스터 프로필 값을 복사해서 쓰세요.',
      },
      {
        instruction: '2. 세금 정보 — 알라미는 세금 서류를 따로 받지 않습니다. 수익 신고는 본인이 거주지 세무서에 직접 하면 됩니다.',
        note: '미국식 W-8BEN 제출이 필요 없는 사이트입니다.',
      },
      {
        instruction: '3. 지급 수단 연결 — 알라미 대시보드에서 PayPal / Skrill / 계좌이체(bank transfer) 중 하나를 지급 방법으로 설정합니다.',
      },
      {
        instruction: '4. FTP 접속정보 확인 — 알라미는 별도 FTP 비밀번호를 발급하지 않습니다. 아이디는 가입한 알라미 이메일, 비밀번호는 알라미 로그인 비밀번호를 그대로 사용합니다.',
        link: { href: 'https://www.alamy.com/help/contributor-uploading/', label: '알라미 FTP 업로드 안내 열기' },
        note: '접속정보는 upload.alamy.com · FTP 포트 21 입니다. 첫 제출은 Stock 폴더에 최소 3장을 올려야 합니다.',
      },
    ],
  },
};
