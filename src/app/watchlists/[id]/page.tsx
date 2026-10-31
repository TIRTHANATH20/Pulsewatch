import WatchlistDetail from "@/app/components/WatchlistDetail";

export default function WatchlistPage({ params }: { params: { id: string } }) {
  return <WatchlistDetail id={params.id} />;
}
