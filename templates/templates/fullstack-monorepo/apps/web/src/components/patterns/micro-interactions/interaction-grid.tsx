import { getConfig } from "../../../lib/design-system/config"

const microInteractions = [
  {
    title: "Skeleton Shimmer",
    description: "Loading placeholders with shifting light reflections",
    category: "loading",
  },
  {
    title: "Ripple Effect",
    description: "Visual waves rippling from click coordinates",
    category: "feedback",
  },
  {
    title: "Magnetic Button",
    description: "Buttons that pull toward the cursor on hover",
    category: "hover",
  },
  {
    title: "Particle Burst",
    description: "CTAs that burst into particles on success",
    category: "success",
  },
  {
    title: "Directional Hover",
    description: "Fill enters from the exact side the mouse entered",
    category: "hover",
  },
  {
    title: "Breathing Status",
    description: "Live indicators with subtle pulse animation",
    category: "status",
  },
]

export function MicroInteractionGrid() {
  const config = getConfig()
  const hasMotion = config.motionIntensity > 4

  if (!hasMotion) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>Motion intensity is low ({config.motionIntensity}/10). Enable &gt;4 for micro-interactions.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-8">
      {microInteractions.map((item) => (
        <div
          key={item.title}
          className="group relative p-6 rounded-xl border border-border/50 bg-card hover:border-border transition-colors cursor-pointer"
        >
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {item.category}
          </span>
          <h3 className="mt-3 text-base font-medium">{item.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          <div className="mt-4 h-px w-0 group-hover:w-full bg-primary transition-all duration-500" />
        </div>
      ))}
    </div>
  )
}
