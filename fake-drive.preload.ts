// Test helper (see send.test.ts): sends requests for drive.google.com to a local stub server
// whose address is in FAKE_DRIVE_ORIGIN, so a test can run send.ts against a made-up routes file.
const origin = process.env.FAKE_DRIVE_ORIGIN;
if (origin) {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    real(String(input).replace("https://drive.google.com", origin), init)) as unknown as typeof fetch;
}
