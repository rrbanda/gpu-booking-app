"use client";

import { useState } from "react";
import TabBar from "./components/TabBar";
import BookingView from "./components/BookingView";
import AgentView from "./components/agent/AgentView";

export default function BookingPage() {
  const [activeTab, setActiveTab] = useState<"booking" | "agent">("booking");

  return (
    <div className="min-h-screen">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className={activeTab !== "booking" ? "hidden" : undefined}>
        <BookingView />
      </div>
      <div className={activeTab !== "agent" ? "hidden" : undefined}>
        <AgentView />
      </div>
    </div>
  );
}
