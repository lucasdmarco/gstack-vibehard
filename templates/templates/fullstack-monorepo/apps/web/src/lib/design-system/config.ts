export type TasteEngine = "brutalist" | "soft" | "minimalist" | "stitch"

export interface DesignDial {
  name: string
  value: number
  min: number
  max: number
  description: string
}

export interface DesignSystemConfig {
  engine: TasteEngine
  mode: "light" | "dark"
  designVariance: number
  motionIntensity: number
  visualDensity: number
  primaryColor?: string
  fontFamily?: string
}

const STORAGE_KEY = "gstack_vibehard-design-system"

const defaultConfig: DesignSystemConfig = {
  engine: "minimalist",
  mode: "light",
  designVariance: 7,
  motionIntensity: 5,
  visualDensity: 4,
}

export function getConfig(): DesignSystemConfig {
  if (typeof window === "undefined") return defaultConfig
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig
  } catch {
    return defaultConfig
  }
}

export function saveConfig(config: Partial<DesignSystemConfig>) {
  if (typeof window === "undefined") return
  const current = getConfig()
  const merged = { ...current, ...config }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  applyTheme(merged)
}

export function applyTheme(config: DesignSystemConfig) {
  if (typeof document === "undefined") return
  const root = document.documentElement

  root.classList.remove("brutalist", "soft", "minimalist", "stitch")
  root.classList.add(config.engine)

  if (config.mode === "dark") {
    root.classList.add("dark")
  } else {
    root.classList.remove("dark")
  }

  root.style.setProperty("--design-variance", String(config.designVariance))
  root.style.setProperty("--motion-intensity", String(config.motionIntensity))
  root.style.setProperty("--visual-density", String(config.visualDensity))
}

export const dials: DesignDial[] = [
  {
    name: "DESIGN_VARIANCE",
    value: 7,
    min: 1,
    max: 10,
    description: "1=Perfect symmetry, 10=Artistic chaos",
  },
  {
    name: "MOTION_INTENSITY",
    value: 5,
    min: 1,
    max: 10,
    description: "1=Static, 10=Cinematic physics",
  },
  {
    name: "VISUAL_DENSITY",
    value: 4,
    min: 1,
    max: 10,
    description: "1=Art gallery, 10=Cockpit",
  },
]

export function engineLabel(engine: TasteEngine): string {
  const labels: Record<TasteEngine, string> = {
    brutalist: "Industrial Brutalism",
    soft: "Premium Soft UI",
    minimalist: "Clean Editorial",
    stitch: "Semantic Stitch",
  }
  return labels[engine]
}
