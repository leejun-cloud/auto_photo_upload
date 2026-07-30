import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'StockFlow OS',
  description: '멀티 스톡사진 제출 운영 SaaS 기획 및 초기 프로토타입',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <header className="topbar">
            <div>
              <Link href="/" className="brand">
                StockFlow OS
              </Link>
              <p className="tagline">사진을 올리면 자동으로 스톡 사이트에 제출해 드립니다</p>
            </div>
          </header>
          <main>{children}</main>
          <footer className="footer">
            <Link href="/manual">매뉴얼</Link>
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
