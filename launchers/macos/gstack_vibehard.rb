# typed: false
# frozen_string_literal: true

class GstackVibehard < Formula
  desc "gstack_vibehard — Cross-harness installer & fullstack template kit"
  homepage "https://github.com/anomalyco/gstack-vibehard"
  url "https://github.com/anomalyco/gstack-vibehard/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"
  depends_on "bun"
  depends_on "uv"

  def install
    system "npm", "install", "-g", "@gstack_vibehard/installer"
    bin.install_symlink Dir["#{HOMEBREW_PREFIX}/lib/node_modules/@gstack_vibehard/installer/src/index.js"]
  end

  def post_install
    system "bun", "install", "-g", "github:garrytan/gbrain"
    system "uv", "tool", "install", "graphifyy"
    system "brew", "install", "momhq/tap/mom"
  end

  test do
    system "#{bin}/gstack_vibehard", "doctor"
  end
end
