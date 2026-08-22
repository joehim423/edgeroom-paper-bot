import type { Metadata } from "next";
import { BettingDashboard } from "./BettingDashboard";

export const metadata: Metadata = {
  title: "EdgeRoom Sports Betting Analyst",
  description:
    "A disciplined sports betting dashboard for odds comparison, stake sizing, and P/L tracking.",
};

export default function Home() {
  return <BettingDashboard />;
}
