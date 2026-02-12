import { Command } from 'commander';
import prompts from 'prompts';
import { HostSyncConfig, getConfigPath, saveConfig } from '../lib/config';

export const initCommand = new Command('init')
  .description('初始化 HostSync 配置（保存到本机）')
  .action(async () => {
    const configPath = getConfigPath();

    const answers = await prompts(
      [
        {
          type: 'text',
          name: 'endpoint',
          message: 'S3 Endpoint（支持 https://host:port 或 host:port）',
          validate: (v: string) => (v?.trim() ? true : '必填'),
        },
        {
          type: 'text',
          name: 'bucket',
          message: 'Bucket 名称',
          validate: (v: string) => (v?.trim() ? true : '必填'),
        },
        {
          type: 'text',
          name: 'accessKey',
          message: 'Access Key',
          validate: (v: string) => (v?.trim() ? true : '必填'),
        },
        {
          type: 'password',
          name: 'secretKey',
          message: 'Secret Key',
          validate: (v: string) => (v?.trim() ? true : '必填'),
        },
        {
          type: 'text',
          name: 'region',
          message: 'Region（可选）',
        },
        {
          type: 'toggle',
          name: 'forcePathStyle',
          message: '是否启用 path-style（更兼容多数 S3 兼容对象存储）？',
          initial: true,
          active: '是',
          inactive: '否',
        },
      ],
      {
        onCancel: () => {
          throw new Error('已取消');
        },
      },
    );

    const config: HostSyncConfig = {
      endpoint: String(answers.endpoint),
      bucket: String(answers.bucket),
      accessKey: String(answers.accessKey),
      secretKey: String(answers.secretKey),
      region: answers.region ? String(answers.region) : undefined,
      forcePathStyle: typeof answers.forcePathStyle === 'boolean' ? answers.forcePathStyle : undefined,
    };

    await saveConfig(config);

    // eslint-disable-next-line no-console
    console.log(`配置已保存：${configPath}`);
  });

