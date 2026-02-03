import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Navigating to https://nud.klounge.kr ...');
  await page.goto('https://nud.klounge.kr', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // 페이지가 완전히 로드될 때까지 잠시 대기
  await new Promise(resolve => setTimeout(resolve, 2000));

  const screenshotPath = '/private/tmp/claude-501/-Users-symverse-workspaces-claude-code-slack-connector/1362745f-c23b-4783-84f4-dc6fdec6df8b/scratchpad/nud-klounge-screenshot.png';
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  console.log(`Screenshot saved to: ${screenshotPath}`);

  await browser.close();
})();
