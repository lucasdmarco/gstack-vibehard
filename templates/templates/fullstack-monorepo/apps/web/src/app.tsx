import { Routes, Route } from "react-router-dom"
import { NavigationBar } from "./components/patterns/navigation/navbar"
import { HeroSection } from "./components/patterns/heroes/hero-section"
import { BentoGrid } from "./components/patterns/grids/bento-grid"
import { MicroInteractionGrid } from "./components/patterns/micro-interactions/interaction-grid"
import { applyTheme, getConfig } from "./lib/design-system/config"

const config = getConfig()
applyTheme(config)

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavigationBar />
      <main>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <HeroSection />
                <section className="py-16">
                  <div className="px-8 max-w-[1400px] mx-auto">
                    <h2 className="text-3xl font-bold tracking-tight">Bento Grid</h2>
                    <p className="mt-2 text-muted-foreground">
                      {config.engine} engine with variance {config.designVariance}/10
                    </p>
                  </div>
                  <BentoGrid engine={config.engine} />
                </section>
                <section className="py-16 bg-muted/30">
                  <div className="px-8 max-w-[1400px] mx-auto">
                    <h2 className="text-3xl font-bold tracking-tight">Micro-Interactions</h2>
                    <p className="mt-2 text-muted-foreground">
                      Motion intensity: {config.motionIntensity}/10
                    </p>
                  </div>
                  <MicroInteractionGrid />
                </section>
              </>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
