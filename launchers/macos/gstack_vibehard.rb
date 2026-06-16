# typed: false
# frozen_string_literal: true

class GstackVibehard < Formula
  desc "gstack_vibehard — Cross-harness installer & fullstack template kit"
  homepage "https://github.com/lucasdmarco/gstack-vibehard"
  url "https://github.com/lucasdmarco/gstack-vibehard/archive/refs/tags/v2.3.2.tar.gz"
  sha256 "9a3eeb4507818105c75d5c873baa632e7160b0677f7136cb2ed1945380124d74"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "-g", "@gstack-vibehard/installer"
    bin.install_symlink Dir["#{HOMEBREW_PREFIX}/lib/node_modules/@gstack-vibehard/installer/src/index.js"]
  end

  def caveats
    <<~EOS
      Para configurar o ambiente (instala deps, hooks e agentes), rode:
        gstack_vibehard install
      Para diagnosticar:
        gstack_vibehard doctor
    EOS
  end

  test do
    system "#{bin}/gstack_vibehard", "--version"
  end
end
