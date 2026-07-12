/**
 * contextReader.ts — 读取当前 PowerPoint 演示文稿上下文
 *
 * 获取当前幻灯片文本内容，
 * 作为生成上下文传递给服务端。
 */

/**
 * 读取当前演示文稿的文本概要（遍历所有幻灯片）
 * @returns 文本形式的上下文
 */
export async function readDocumentContext(maxLength = 4000): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (!win.PowerPoint) return '';

    const result = await win.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.slides;
      slides.load('items');
      await context.sync();

      const texts: string[] = [];
      for (let i = 0; i < slides.items.length; i++) {
        const slide = slides.items[i];
        slide.load('shapes');
        await context.sync();

        for (const shape of slide.shapes) {
          if (shape.hasTextFrame) {
            const tf = shape.textFrame;
            tf.load('textRange');
            await context.sync();
            const text = tf.textRange?.text ?? '';
            if (text.trim()) texts.push(text.trim());
          }
        }
      }

      return texts.join('\n').slice(0, maxLength);
    });
    return result ?? '';
  } catch {
    return '';
  }
}

/**
 * 读取当前选中幻灯片的文本
 * @returns 选中幻灯片的文本
 */
export async function readSelectedText(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (!win.PowerPoint) return '';

    const result = await win.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.getSelectedSlides();
      slide.load('items');
      await context.sync();

      if (slide.items.length === 0) return '';

      const selected = slide.items[0];
      selected.load('shapes');
      await context.sync();

      const texts: string[] = [];
      for (const shape of selected.shapes) {
        if (shape.hasTextFrame) {
          const tf = shape.textFrame;
          tf.load('textRange');
          await context.sync();
          const text = tf.textRange?.text ?? '';
          if (text.trim()) texts.push(text.trim());
        }
      }

      return texts.join('\n');
    });
    return result ?? '';
  } catch {
    return '';
  }
}
