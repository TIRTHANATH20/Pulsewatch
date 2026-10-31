import HoldingDetail from "@/app/components/HoldingDetail";

export default function HoldingPage({
  params,
}: {
  params: { watchlistId: string; itemId: string };
}) {
  return <HoldingDetail watchlistId={params.watchlistId} itemId={params.itemId} />;
}
