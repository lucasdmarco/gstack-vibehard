# typed: false
# frozen_string_literal: true

class GstackVibehard < Formula
  desc "gstack_vibehard — Cross-harness installer & fullstack template kit"
  homepage "https://github.com/lucasdmarco/gstack-vibehard"
  url "https://github.com/lucasdmarco/gstack-vibehard/archive/refs/tags/v0.4.0.tar.gz"
  sha256 "TBD_AFTER_RELEASE" # Will be updated after v0.4.0 release
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "-g", "@gstack-vibehard/installer"
    bin.install_symlink Dir["#{HOMEBREW_PREFIX}/lib/node_modules/@gstack-vibehard/installer/src/index.js"]
  end

  def post_install
    ohai "Running gstack_vibehard install..."
    system "gstack_vibehard", "install"
  end

  test do
    system "#{bin}/gstack_vibehard", "doctor"
  end
end
