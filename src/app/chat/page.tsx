"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PulseWatchChat from "@/app/components/PulseWatchChat";

function ChatContent() {
  const params = useSearchParams();
  const ticker = params.get("ticker");
  const initial = ticker ? `What's the latest on ${ticker.toUpperCase()}?` : undefined;
  return (
    <div className="page chat-page">
      <PulseWatchChat initialQuestion={initial} />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="page">Loading…</div>}>
      <ChatContent />
    </Suspense>
  );
}
