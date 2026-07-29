import type { FtpProtocol, PlatformKey } from '../domain';
import { FTP_ENDPOINTS } from './endpoints';

// 클라이언트에 노출해도 안전한 플랫폼 프리셋.
// host/port/protocol 은 공개된 서버 주소라 비밀이 아니다. 비밀번호는 절대 포함하지 않는다.
export type PlatformPreset = {
  key: PlatformKey;
  label: string;
} & (
  | {
      available: true;
      host: string;
      port: number;
      protocol: FtpProtocol;
      signupUrl: string;
      helpText: string;
    }
  | { available: false }
);

const LABELS: Record<PlatformKey, string> = {
  adobe: '어도비 스톡',
  shutterstock: '셔터스톡',
  alamy: '알라미',
  getty: '게티 / 아이스톡',
};

// 각 에이전시에서 FTP 아이디/비밀번호를 확인하는 안내 (한국어).
const HELP: Partial<Record<PlatformKey, { signupUrl: string; helpText: string }>> = {
  adobe: {
    signupUrl: 'https://contributor.stock.adobe.com/',
    helpText: '어도비 스톡 컨트리뷰터 페이지에 로그인한 뒤 계정 설정 안에서 FTP 사용자명과 비밀번호를 확인할 수 있어요.',
  },
  shutterstock: {
    signupUrl: 'https://submit.shutterstock.com/',
    helpText: '셔터스톡 컨트리뷰터에 로그인한 뒤 업로드 설정에서 FTP 사용자명과 비밀번호를 확인할 수 있어요.',
  },
  alamy: {
    signupUrl: 'https://www.alamy.com/contributor/',
    helpText: '알라미 컨트리뷰터에 로그인한 뒤 FTP 업로드 안내에서 사용자명과 비밀번호를 확인할 수 있어요.',
  },
};

export const PLATFORM_PRESETS: PlatformPreset[] = (Object.keys(LABELS) as PlatformKey[]).map((key) => {
  const endpoint = FTP_ENDPOINTS[key];
  const help = HELP[key];
  if (!endpoint || !help) {
    return { key, label: LABELS[key], available: false };
  }
  return {
    key,
    label: LABELS[key],
    available: true,
    host: endpoint.host,
    port: endpoint.port,
    protocol: endpoint.protocol,
    signupUrl: help.signupUrl,
    helpText: help.helpText,
  };
});
