use std::env;

fn main() {
    let key = env::var("ACME_KEY").unwrap_or_default();
    println!("acme-rs {}", key);
}
