import { Spinner, logger } from '../utils/logger.js';
import { ensureProjectRoot, loadContext } from '../core/context.js';
import { reviewImages, saveReviewRecord } from '../core/visual-review.js';

export interface VisualReviewOptions {
  iteration?: string;
  /** 待审图片（可多个：基线 / 新图 / diff 图） */
  image: string[];
  /** 审查问题（如「该截图是否符合 UI_SPEC 的页面描述」） */
  question: string;
  /** 补充上下文（UI_SPEC 描述 / AC 文本） */
  context?: string;
}

/**
 * 视觉模型审查（OpenAI 兼容协议，可选审查器）
 *
 * 像素比对由 playwright 完成；此命令补「看得懂」的环节——
 * 基线确认、失败 diff 分析、语义断言。未配置视觉段时如实报缺。
 */
export async function visualReviewCommand(options: VisualReviewOptions): Promise<void> {
  const projectRoot = ensureProjectRoot();
  const context = loadContext(projectRoot);
  const iteration = options.iteration || context.currentIteration;

  if (!iteration) {
    logger.error('请指定期次名称：spectest visual-review -i <期次> --image <图片> --question <审查问题>');
    process.exit(1);
  }
  if (!options.question || options.question.trim() === '') {
    logger.error('请提供审查问题：--question <文本>（如「该截图是否符合 UI_SPEC 的页面描述」）');
    process.exit(1);
  }
  if (options.image.length === 0) {
    logger.error('请提供至少一张待审图片：--image <路径>（可多次指定，如基线+diff 图）');
    process.exit(1);
  }

  const spinner = new Spinner('正在调用视觉模型审查...');
  spinner.start();
  let result;
  try {
    result = await reviewImages({
      projectRoot,
      iteration,
      images: options.image,
      question: options.question,
      context: options.context,
    });
    spinner.stop('');
  } catch (error) {
    spinner.fail(`视觉审查失败：${error}`);
    process.exit(1);
  }

  if (!('verdict' in result)) {
    // 审查不可用：如实报缺，不脑补判定
    logger.warn(`视觉审查不可用：${result.reason}`);
    process.exit(1);
  }

  const icon = result.verdict === 'pass' ? '✅' : result.verdict === 'fail' ? '❌' : '❓';
  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│       👁️  视觉审查结果                   │');
  console.log('├──────────────────────────────────────────┤');
  console.log(`│  判定       │  ${`${icon} ${result.verdict}`.padEnd(20)} │`);
  console.log(`│  模型       │  ${result.model.padEnd(20)} │`);
  console.log('└──────────────────────────────────────────┘');
  console.log('');
  console.log(`判定依据：${result.reason}`);

  const recordPath = saveReviewRecord(projectRoot, iteration, {
    projectRoot,
    iteration,
    images: options.image,
    question: options.question,
    context: options.context,
  }, result);
  console.log('');
  logger.info(`审查记录已落盘：${recordPath}`);

  if (result.verdict === 'fail') {
    process.exitCode = 1;
  }
}
