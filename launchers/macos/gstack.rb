# typed: false
# frozen_string_literal: true

class Gstack < Formula
  desc "GStack VibeHard — Cross-harness installer & fullstack template kit"
  homepage "https://github.com/anomalyco/gstack-vibehard"
  url "https://github.com/anomalyco/gstack-vibehard/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "-g", "@gstack/installer"
    bin.install_symlink Dir["#{HOMEBREW_PREFIX}/lib/node_modules/@gstack/installer/src/index.js"]
  end

  test do
    system "#{bin}/gstack", "doctor"
  end
end
