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
              <p className="tagline">업로드 자동화 + 승인율 최적화 + 반려 대응 운영 OS</p>
            </div>
            <nav className="nav">
              <Link href="/">개요</Link>
              <Link href="/manual">기획서/매뉴얼</Link>
            </nav>
          </header>
          <main>{children}</main>
          <footer className="footer">
            <Link href="/terms">이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
