import { readFileSync } from 'node:fs';

const messageLimit = process.argv.includes('--compact') ? 400 : 2200;
for (const file of process.argv.slice(2).filter(arg => arg !== '--compact')) {
  const report = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  console.log(file);
  if (report.stats) {
    console.log(JSON.stringify(report.stats));
    const visit = suite => {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        if (test.status !== 'unexpected') continue;
        console.log(JSON.stringify({ file: spec.file, title: spec.title, results: test.results.map(result => ({
          status: result.status, message: result.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, messageLimit),
        })) }));
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites) visit(suite);
    for (const error of report.errors ?? []) console.log(JSON.stringify(error));
  } else {
    console.log(JSON.stringify({ total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests }));
    for (const result of report.testResults ?? []) for (const assertion of result.assertionResults ?? []) {
      if (assertion.status === 'failed') console.log(JSON.stringify({ file: result.name, title: assertion.fullName,
        errors: assertion.failureMessages.map(message => message.replace(/\u001b\[[0-9;]*m/g, '').slice(0, messageLimit)) }));
    }
  }
}
