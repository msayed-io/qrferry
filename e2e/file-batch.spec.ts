import { expect, test, type Page } from "./test";
const file = (name: string, size?: number) => ({
  name,
  mimeType: "text/plain",
  buffer: size ? Buffer.alloc(size, 65) : Buffer.from(`contents of ${name}`),
});
async function add(page: Page, files: ReturnType<typeof file>[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".batch-add").click();
  await (await chooser).setFiles(files);
}

test("batch: phone can add up to three files individually and remove any before sending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', file("one.txt"));
  await add(page, [file("two.txt")]);
  await add(page, [file("three.txt")]);
  await expect(page.locator(".batch-file .fname")).toHaveText([
    "one.txt",
    "two.txt",
    "three.txt",
  ]);
  await expect(page.locator(".batch-summary")).toContainText("3 / 3");
  await expect(page.locator(".batch-add")).toBeDisabled();
  await page
    .getByRole("button", { name: "إزالة two.txt", exact: true })
    .click();
  await expect(page.locator(".batch-file .fname")).toHaveText([
    "one.txt",
    "three.txt",
  ]);
  await add(page, [file("replacement.txt")]);
  await expect(page.locator(".batch-file .fname")).toHaveText([
    "one.txt",
    "three.txt",
    "replacement.txt",
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("batch: selecting or appending too many files preserves the existing list", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', [
    file("one.txt"),
    file("two.txt"),
  ]);
  await add(page, [file("three.txt"), file("four.txt")]);
  await expect(
    page.getByText(/يمكن إرسال 3 ملفات بحد أقصى في المرة الواحدة/),
  ).toBeVisible();
  await expect(page.locator(".batch-file .fname")).toHaveText([
    "one.txt",
    "two.txt",
  ]);
  await page.setInputFiles('input[type="file"]', [
    file("a"),
    file("b"),
    file("c"),
    file("d"),
  ]);
  await expect(page.locator(".batch-file .fname")).toHaveText([
    "one.txt",
    "two.txt",
  ]);
  await expect(page.locator(".fast-action")).toBeEnabled();
});

test("batch: change replaces rather than appends, and removing the last file clears both send paths", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', file("first.txt"));
  await expect(page.locator(".batch-add")).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".batch-summary button").click();
  await (await chooser).setFiles(file("second.txt"));
  await expect(page.locator(".batch-file .fname")).toHaveText(["second.txt"]);
  await page
    .getByRole("button", { name: "إزالة second.txt", exact: true })
    .click();
  await expect(page.locator(".selected-files")).toHaveCount(0);
  await expect(page.locator(".fast-action")).toBeDisabled();
  await expect(page.locator(".primary-action")).toBeDisabled();
  await expect(page.locator(".qr-stage canvas")).toHaveCount(0);
});

test("batch: adding a large file invalidates the previous small-file optical payload", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', file("small.txt"));
  await expect(page.locator(".qr-stage canvas").first()).toBeVisible();
  await add(page, [file("large.txt", 2 * 1024 * 1024)]);
  await expect(page.locator(".batch-file")).toHaveCount(2);
  await expect(page.locator(".fast-action")).toBeEnabled();
  await expect(page.locator(".qr-stage canvas")).toHaveCount(0);
});

test("batch: dropped files respect the same maximum without silently truncating", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', file("keep.txt"));
  await expect(page.locator(".batch-add")).toBeEnabled();
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    for (let i = 0; i < 3; i++)
      dt.items.add(
        new File(["extra"], `extra-${i}.txt`, { type: "text/plain" }),
      );
    return dt;
  });
  await page.locator(".control-panel").dispatchEvent("drop", { dataTransfer });
  await expect(
    page.getByText(/يمكن إرسال 3 ملفات بحد أقصى في المرة الواحدة/),
  ).toBeVisible();
  await expect(page.locator(".batch-file .fname")).toHaveText(["keep.txt"]);
  await dataTransfer.dispose();
});

test("batch: English selection and limits remain understandable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Switch language/ }).click();
  await expect(page.getByLabel("Choose up to 3 files to send")).toHaveAttribute(
    "multiple",
    "",
  );
  await page.setInputFiles('input[type="file"]', [
    file("a"),
    file("b"),
    file("c"),
    file("d"),
  ]);
  await expect(page.getByText(/Send up to 3 files at once/)).toBeVisible();
  await expect(page.locator(".fast-action")).toBeDisabled();
});
