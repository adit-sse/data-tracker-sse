const { chromium } = require('playwright');

(async () => {
  const url = 'http://localhost:3001/clients/1/invoices/new';
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    const startInput = page.getByLabel('Period Start Date');
    const endInput = page.getByLabel('Period End Date');

    const cases = [
      { start: '2026-03-01', name: 'Start on 1st (month-end expected)' },
      { start: '2026-01-31', name: 'End of month -> next month shorter' },
      { start: '2026-02-15', name: 'Middle of month -> same day next month' }
    ];

    for (const c of cases) {
      console.log('\n---');
      console.log('Case:', c.name, 'start=', c.start);
      await startInput.fill(c.start);
      // Trigger blur/tab to ensure change handlers run
      await startInput.press('Tab');
      // Small wait for React state updates
      await page.waitForTimeout(300);
      const endVal = await endInput.inputValue();
      console.log('Period end value:', endVal);
    }

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
})();
