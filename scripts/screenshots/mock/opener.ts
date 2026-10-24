/** Stand-in for @tauri-apps/plugin-opener: the screenshots never leave the page. */
export async function openUrl(url: string): Promise<void> {
  console.info(`demo would open ${url}`);
}
