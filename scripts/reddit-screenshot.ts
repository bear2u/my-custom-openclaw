import puppeteer from 'puppeteer';
import path from 'path';

async function takeRedditScreenshot() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  try {
    const page = await browser.newPage();

    console.log('레딧으로 이동 중...');
    await page.goto('https://www.reddit.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // 페이지가 로드될 때까지 잠시 대기
    await new Promise(resolve => setTimeout(resolve, 2000));

    const screenshotPath = path.join(process.cwd(), 'screenshots', `reddit-${Date.now()}.png`);

    console.log('스크린샷 촬영 중...');
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    console.log(`스크린샷 저장 완료: ${screenshotPath}`);

    // 브라우저를 3초간 열어둠 (사용자가 확인할 수 있도록)
    await new Promise(resolve => setTimeout(resolve, 3000));

    await browser.close();

    return screenshotPath;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

takeRedditScreenshot()
  .then(path => console.log('완료:', path))
  .catch(error => console.error('에러:', error));
