import { Command } from 'commander';
import { initCommand } from './commands/init';
import { pushCommand } from './commands/push';
import { pullCommand } from './commands/pull';
import { listCommand } from './commands/list';
import { scanCommand } from './commands/scan';
import { webCommand } from './commands/web';

const program = new Command();

program
  .name('hostsync')
  .description('HostSync - 基于 S3 兼容存储的主机分层配置同步工具')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);
program.addCommand(listCommand);
program.addCommand(scanCommand);
program.addCommand(webCommand);

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

