import {test,expect} from '@playwright/test';
test('Pagesサブパスで共有URLから参加できる',async({context,page})=>{
 await page.goto('/tier-table/');await page.getByLabel('あなたの名前').fill('ホスト');await page.getByRole('button',{name:'ルームをつくる'}).click();await expect(page.getByRole('heading',{name:'みんなを待っています'})).toBeVisible();expect(new URL(page.url()).pathname).toBe('/tier-table/');
 const other=await context.newPage();await other.goto(page.url());await other.getByLabel('あなたの名前').fill('友だち');await other.getByRole('button',{name:'ルームに参加'}).click();await expect(page.getByText('友だち',{exact:true})).toBeVisible();
});
