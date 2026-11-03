import { ResearchApp } from "@/components/ResearchApp";
import { getPublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <ResearchApp config={getPublicConfig()} />;
}
