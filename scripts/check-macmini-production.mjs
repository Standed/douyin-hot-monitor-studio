#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = {
    localBaseUrl: process.env.DOUYIN_LOCAL_BASE_URL || 'http://127.0.0.1:5174',
    parserUrl: process.env.DOUYIN_PARSER_HEALTH_URL || 'http://127.0.0.1:8091/openapi.json',
    publicUrl: process.env.DOUYIN_PUBLIC_URL || 'https://douyin.aizao.ai/',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--local-base-url') {
      args.localBaseUrl = value || args.localBaseUrl;
      index += 1;
    } else if (key === '--parser-url') {
      args.parserUrl = value || args.parserUrl;
      index += 1;
    } else if (key === '--public-url') {
      args.publicUrl = value || args.publicUrl;
      index += 1;
    } else if (key === '--help' || key === '-h') {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/check-macmini-production.mjs',
    '  node scripts/check-macmini-production.mjs --local-base-url http://127.0.0.1:5174 --parser-url http://127.0.0.1:8091/openapi.json',
    '',
    'Checks the Mac mini production baseline for douyin.aizao.ai.',
  ].join('\n');
}

function parseLaunchctlList(output) {
  const services = new Map();
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [pid, status, ...labelParts] = line.split(/\s+/);
    const label = labelParts.join(' ');
    if (!label) continue;
    services.set(label, {
      pid,
      status,
      running: pid !== '-',
    });
  }
  return services;
}

function printCheck(label, ok, detail = '', action = '') {
  console.log(`${ok ? 'ok' : 'fail'} ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok && action) console.log(`  action: ${action}`);
  return ok;
}

async function checkHttp(label, url, expectedStatuses, options = {}) {
  try {
    const response = await fetch(url, { redirect: 'manual', cache: 'no-store' });
    const location = response.headers.get('location') ?? '';
    const statusOk = expectedStatuses.includes(response.status);
    const accessOk = !options.expectAccess || location.includes('cloudflareaccess.com');
    return printCheck(
      label,
      statusOk && accessOk,
      `HTTP ${response.status}${location ? ` -> ${location.split('?')[0]}` : ''}`,
      options.action,
    );
  } catch (error) {
    return printCheck(label, false, error instanceof Error ? error.message : String(error), options.action);
  }
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(usage());
  process.exit(0);
}

let failed = false;
let services = new Map();

try {
  const { stdout } = await execFileAsync('launchctl', ['list']);
  services = parseLaunchctlList(stdout);
} catch (error) {
  failed = true;
  printCheck('launchd list', false, error instanceof Error ? error.message : String(error));
}

for (const label of ['company.douyin-hot-monitor-studio', 'company.douyin-parser']) {
  const service = services.get(label);
  const ok = Boolean(service?.running);
  if (!printCheck(`launchd ${label}`, ok, service ? `pid=${service.pid} status=${service.status}` : 'missing', '确认 Mac mini production launchd 是否已安装并启动。')) {
    failed = true;
  }
}

const devService = services.get('company.douyin-hot-monitor-studio.dev');
if (!printCheck('old Vite dev launchd stopped', !devService?.running, devService?.running ? `pid=${devService.pid} status=${devService.status}` : 'not running', '不要长期用 Vite dev server 承接同事访问。')) {
  failed = true;
}

const localBaseUrl = args.localBaseUrl.replace(/\/$/, '');
if (!(await checkHttp('local UI', `${localBaseUrl}/`, [200], { action: '确认 5174 静态 dist + /api proxy 是否运行。' }))) failed = true;
if (!(await checkHttp('local dashboard API', `${localBaseUrl}/api/dashboard`, [200], { action: '确认 Express API 和 5174 /api 反代是否运行。' }))) failed = true;
if (!(await checkHttp('parser API', args.parserUrl, [200], { action: '确认 Douyin parser 兼容服务是否运行。' }))) failed = true;
if (!(await checkHttp('public Access gate', args.publicUrl, [302], { expectAccess: true, action: '公网入口应由 Cloudflare Access OTP 保护。' }))) failed = true;

console.log(`localBaseUrl=${localBaseUrl}`);
console.log(`parserUrl=${args.parserUrl}`);
console.log(`publicUrl=${args.publicUrl}`);
console.log(`decision=${failed ? 'not_ready' : 'production_baseline_ready'}`);

if (failed) process.exit(1);
