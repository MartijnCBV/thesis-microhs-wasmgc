#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const PerformanceRunner = require('./wasm-runner');

const program = new Command();

program
    .name('perf-harness')
    .description('Performance testing harness for WebAssembly and JavaScript modules')
    .version('1.0.0');

program
    .command('run')
    .description('Run performance benchmark on a WASM or JavaScript file')
    .argument('<file>', 'Path to the WebAssembly (.wasm) or JavaScript (.js) file')
    .option('-i, --iterations <number>', 'Number of benchmark iterations', '100')
    .option('-w, --warmup <number>', 'Number of warmup runs', '10')
    .option('-f, --function <name>', 'Function name to call', 'main')
    .option('-a, --args <args...>', 'Arguments to pass to the function', [])
    .option('--no-memory', 'Disable memory usage measurement')
    .option('-o, --output <file>', 'Save results to JSON file')
    .option('--format <type>', 'Output format (console|json)', 'console')
    .action(async (file, options) => {
        try {
            if (!fs.existsSync(file)) {
                console.error(chalk.red(`Error: File not found: ${file}`));
                process.exit(1);
            }

            const ext = path.extname(file).toLowerCase();
            if (!['.wasm', '.js'].includes(ext)) {
                console.error(chalk.red(`Error: Unsupported file type: ${ext}. Supported types: .wasm, .js`));
                process.exit(1);
            }

            const args = options.args.map(arg => {
                const num = Number(arg);
                return isNaN(num) ? arg : num;
            });

            const fileType = ext === '.wasm' ? 'WebAssembly' : 'JavaScript';
            console.log(chalk.blue(`Starting ${fileType} Performance Benchmark`));
            console.log(chalk.gray(`File: ${path.resolve(file)}`));
            console.log(chalk.gray(`Type: ${fileType}`));
            console.log(chalk.gray(`Function: ${options.function}`));
            console.log(chalk.gray(`Iterations: ${options.iterations}`));
            console.log(chalk.gray(`Warmup: ${options.warmup}`));
            if (args.length > 0) {
                console.log(chalk.gray(`Arguments: [${args.join(', ')}]`));
            }

            const runner = new PerformanceRunner();
            
            const results = await runner.runBenchmark(file, {
                iterations: parseInt(options.iterations),
                warmupRuns: parseInt(options.warmup),
                functionName: options.function,
                args: args,
                measureMemory: options.memory
            });

            if (options.format === 'json') {
                console.log(runner.formatResults(results, 'json'));
            } else {
                console.log(chalk.green(runner.formatResults(results, 'console')));
            }

            if (options.output) {
                runner.saveResults(results, options.output);
            }

        } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

program
    .command('validate')
    .description('Validate a WASM or JS file and list its exports/functions')
    .argument('<file>', 'Path to the WebAssembly (.wasm) or JavaScript (.js) file')
    .action(async (file) => {
        try {
            if (!fs.existsSync(file)) {
                console.error(chalk.red(`Error: File not found: ${file}`));
                process.exit(1);
            }

            const ext = path.extname(file).toLowerCase();
            if (!['.wasm', '.js'].includes(ext)) {
                console.error(chalk.red(`Error: Unsupported file type: ${ext}. Supported types: .wasm, .js`));
                process.exit(1);
            }

            const fileType = ext === '.wasm' ? 'WebAssembly' : 'JavaScript';
            console.log(chalk.blue(`🔍 Validating ${fileType} Module`));
            
            const runner = new PerformanceRunner();
            const module = await runner.loadModule(file);
            
            console.log(chalk.green(`✓ ${fileType} module loaded successfully`));
            
            if (ext === '.wasm') {
                console.log(chalk.blue('\nExported Functions:'));
                
                const exports = Object.keys(module.instance.exports);
                if (exports.length === 0) {
                    console.log(chalk.yellow('  No exports found'));
                } else {
                    exports.forEach(exportName => {
                        const exportValue = module.instance.exports[exportName];
                        const type = typeof exportValue;
                        console.log(chalk.gray(`  ${exportName}: ${type}`));
                    });
                }

                if (module.instance.exports.memory) {
                    const memory = module.instance.exports.memory;
                    console.log(chalk.blue('\nMemory Info:'));
                    console.log(chalk.gray(`  Pages: ${memory.buffer.byteLength / 65536}`));
                    console.log(chalk.gray(`  Size: ${(memory.buffer.byteLength / 1024).toFixed(2)} KB`));
                }
            } else if (ext === '.js') {
                console.log(chalk.blue('\nAvailable Functions:'));
                
                const moduleExports = Object.keys(module.instance.exports || {});
                const contextFunctions = Object.keys(module.context.Module || {}).filter(key => 
                    typeof module.context.Module[key] === 'function'
                );
                
                if (moduleExports.length > 0) {
                    console.log(chalk.gray('  Module Exports:'));
                    moduleExports.forEach(name => {
                        console.log(chalk.gray(`    ${name}: ${typeof module.instance.exports[name]}`));
                    });
                }
                
                if (contextFunctions.length > 0) {
                    console.log(chalk.gray('  Module Functions:'));
                    contextFunctions.forEach(name => {
                        console.log(chalk.gray(`    ${name}: function`));
                    });
                }
                
                if (moduleExports.length === 0 && contextFunctions.length === 0) {
                    console.log(chalk.yellow('  No functions found. Module will run as-is.'));
                }
            }

        } catch (error) {
            console.error(chalk.red(`Validation failed: ${error.message}`));
            process.exit(1);
        }
    });

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
    process.exit(1);
});

program.parse();