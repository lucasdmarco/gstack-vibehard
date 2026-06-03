import { engineLabel, TasteEngine } from "../../lib/design-system/config"

interface BentoCard {
  title: string
  description: string
  colSpan?: string
  rowSpan?: string
}

const bentoData: Record<TasteEngine, BentoCard[]> = {
  brutalist: [
    { title: "METRICS", description: "Real-time system telemetry", colSpan: "md:col-span-2", rowSpan: "md:row-span-2" },
    { title: "LOGS", description: "Operational audit trail" },
    { title: "STATUS", description: "Component health check" },
    { title: "ALERTS", description: "Critical notifications" },
  ],
  soft: [
    { title: "Analytics", description: "Dashboard with live metrics", colSpan: "md:col-span-2", rowSpan: "md:row-span-2" },
    { title: "Activity", description: "Recent user actions" },
    { title: "Performance", description: "System benchmarks" },
    { title: "Insights", description: "AI-powered recommendations" },
  ],
  minimalist: [
    { title: "Overview", description: "Key metrics at a glance", colSpan: "md:col-span-2", rowSpan: "md:row-span-2" },
    { title: "Activity", description: "Recent changes" },
    { title: "Usage", description: "Resource consumption" },
    { title: "Team", description: "Active members" },
  ],
  stitch: [
    { title: "Dashboard", description: "Main operational view", colSpan: "md:col-span-2", rowSpan: "md:row-span-2" },
    { title: "Reports", description: "Generated summaries" },
    { title: "Analytics", description: "Data insights" },
    { title: "Settings", description: "Configuration panel" },
  ],
}

export function BentoGrid({ engine }: { engine: TasteEngine }) {
  const cards = bentoData[engine]

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-8">
      {cards.map((card, i) => (
        <div
          key={card.title}
          className={`group relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] transition-all duration-300 hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] ${card.colSpan || ""} ${card.rowSpan || ""}`}
        >
          <div className="flex flex-col h-full justify-between">
            <div>
              <span className="text-xs font-mono tracking-wider text-muted-foreground uppercase">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">{card.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-[40ch]">
                {card.description}
              </p>
            </div>
            <div className="mt-8 flex items-center gap-2 text-sm font-medium text-primary">
              <span>Explore</span>
              <span className="transition-transform duration-300 group-hover:translate-x-1">&rarr;</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
