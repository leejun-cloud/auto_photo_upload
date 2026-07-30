import { getCurrentUser } from '@/lib/auth';
import { listAssetsForUser } from '@/lib/repository';
import { StockDashboardClient } from '@/components/stock-dashboard-client';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();
  const assets = user ? await listAssetsForUser(user.id) : [];

  return (
    <div className="page-grid">
      <section className="hero card">
        <h1>사진 올리고, 나머지는 맡기세요</h1>
        <p className="lead">
          사진을 올리면 제목·설명·키워드를 자동으로 만들고, 여러 스톡 사이트에 한 번에 제출해 드립니다.
        </p>
      </section>

      <StockDashboardClient currentUser={user} initialAssets={assets} />
    </div>
  );
}
