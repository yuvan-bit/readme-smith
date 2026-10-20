Gem::Specification.new do |spec|
  spec.name = "acme-gem"
  spec.version = "2.0.1"
  spec.summary = "Widget helpers for Ruby."
  spec.description = "Widget helpers for Ruby applications."
  spec.license = "MIT"
  spec.executables = ["acme"]
  spec.add_dependency "rack", "~> 3.0"
  spec.add_development_dependency "rspec", "~> 3.13"
end
