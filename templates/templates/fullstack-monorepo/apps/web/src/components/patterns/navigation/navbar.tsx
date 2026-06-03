export function NavigationBar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-6 h-16 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-8">
          <a href="/" className="text-lg font-bold tracking-tight">
            gstack_vibehard
          </a>
          <div className="hidden md:flex items-center gap-6">
            {["Features", "Docs", "Blog", "Pricing"].map((item) => (
              <a
                key={item}
                href="#"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {item}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="hidden sm:inline-flex px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">
            Sign In
          </button>
          <button className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
            Get Started
          </button>
        </div>
      </div>
    </nav>
  )
}
