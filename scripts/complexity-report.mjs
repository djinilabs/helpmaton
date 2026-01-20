import { ESLint } from 'eslint'
import { glob } from 'glob'
import { promises as fs } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const args = process.argv.slice(2)

const getArgValue = (flag, fallback) => {
  const flagIndex = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`))
  if (flagIndex === -1) {
    return fallback
  }

  const arg = args[flagIndex]
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=').trim() || fallback
  }

  return args[flagIndex + 1] ?? fallback
}

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const topLimit = toNumber(getArgValue('--top', 20), 20)
const outputPath = resolve(repoRoot, getArgValue('--out', 'docs/complexity-report.md'))

const targetGlobs = [
  'apps/backend/src/**/*.{ts,tsx}',
  'apps/frontend/src/**/*.{ts,tsx}',
  'apps/widget/src/**/*.{ts,tsx}'
]

const targetFiles = await glob(targetGlobs, {
  cwd: repoRoot,
  absolute: true,
  ignore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/test-results/**',
    '**/playwright-report/**'
  ]
})

if (targetFiles.length === 0) {
  console.error('No TypeScript source files found to analyze.')
  process.exit(1)
}

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        complexity: ['error', 0]
      }
    }
  ]
})

const results = await eslint.lintFiles(targetFiles)

const extractComplexity = (message) => {
  const match = message.match(/complexity of (\d+)/i)
  if (!match) {
    return null
  }
  return Number.parseInt(match[1], 10)
}

const extractFunctionName = (message) => {
  const match = message.match(/(?:Function|Method) '([^']+)'/i)
  return match ? match[1] : '<anonymous>'
}

const escapeTableCell = (value) => String(value).replaceAll('|', '\\|')

const entries = []

for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== 'complexity') {
      continue
    }

    const complexity = extractComplexity(message.message)
    if (!complexity) {
      continue
    }

    entries.push({
      filePath: relative(repoRoot, result.filePath),
      functionName: extractFunctionName(message.message),
      complexity,
      line: message.line ?? null
    })
  }
}

entries.sort((a, b) => {
  if (b.complexity !== a.complexity) {
    return b.complexity - a.complexity
  }
  if (a.filePath !== b.filePath) {
    return a.filePath.localeCompare(b.filePath)
  }
  return (a.line ?? 0) - (b.line ?? 0)
})

const totalFunctions = entries.length
const complexityAtLeastTwo = entries.filter((entry) => entry.complexity >= 2).length
const topEntries = entries.slice(0, Math.max(0, topLimit))

const reportLines = [
  '# Function Complexity Report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Summary',
  '',
  `- Total functions analyzed: ${totalFunctions}`,
  `- Functions with complexity >= 2: ${complexityAtLeastTwo}`,
  '',
  `## Top ${topEntries.length} most complex functions`,
  '',
  '| Rank | Complexity | Function | Location |',
  '| --- | --- | --- | --- |'
]

for (const [index, entry] of topEntries.entries()) {
  const locationSuffix = entry.line ? `:${entry.line}` : ''
  reportLines.push(
    `| ${index + 1} | ${entry.complexity} | ${escapeTableCell(entry.functionName)} | ${escapeTableCell(entry.filePath)}${locationSuffix} |`
  )
}

reportLines.push(
  '',
  '## How to run',
  '',
  '`pnpm complexity:report`',
  '',
  'Options:',
  '- `--top <number>`: limit list size (default 20)',
  '- `--out <path>`: output path (default docs/complexity-report.md)',
  ''
)

await fs.mkdir(dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${reportLines.join('\n')}\n`, 'utf8')

console.log(`Complexity report written to ${relative(repoRoot, outputPath)}`)
