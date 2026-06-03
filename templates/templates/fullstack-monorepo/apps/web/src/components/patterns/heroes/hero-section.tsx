import { getConfig, engineLabel } from "../../lib/design-system/config"

export function HeroSection() {
  const config = getConfig()
  const isHighVariance = config.designVariance > 4
  const isDark = config.mode === "dark"

  return (
    <section
      className={`relative w-full overflow-hidden ${
        isHighVariance
          ? "grid grid-cols-1 md:grid-cols-2"
          : "flex flex-col items-center text-center"
      } ${isDark ? "bg-background" : ""}`}
    >
      <div
        className={`relative z-10 flex flex-col justify-center ${
          isHighVariance ? "px-8 md:px-16 py-24" : "px-8 py-24 max-w-4xl mx-auto"
        }`}
      >
        <span className="inline-flex items-center gap-2 px-3 py-1 mb-6 text-xs font-mono tracking-widest uppercase border border-border rounded-full w-fit">
          {engineLabel(config.engine)}
        </span>
        <h1 className="text-4xl font-bold tracking-tighter md:text-6xl lg:text-7xl leading-none">
          Build
          <span className="block text-primary">Something</span>
          <span className="block">Extraordinary</span>
        </h1>
        <p className="mt-6 text-base leading-relaxed text-muted-foreground max-w-[65ch]">
          A production-grade fullstack template with taste-driven design system.
          Choose your engine, tune the dials, ship world-class interfaces.
        </p>
        <div className={`flex gap-4 mt-8 ${isHighVariance ? "" : "justify-center"}`}>
          <button className="px-6 py-3 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
            Get Started
          </button>
          <button className="px-6 py-3 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">
            Learn More
          </button>
        </div>
      </div>

      {isHighVariance && (
        <div className="relative hidden md:flex items-center justify-center bg-muted min-h-[600px] overflow-hidden">
          <div className="grid grid-cols-3 gap-4 p-8 w-full h-full">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-lg aspect-square"
                style={{
                  marginTop: i % 2 === 0 ? `${i * 4}px` : "0",
                  opacity: 1 - i * 0.08,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
