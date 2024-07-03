#!/usr/bin/env node
const PackageManager =  require('./src/PackageManager').PackageManager;
const { Command } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const semver = require('semver');
const JSON5 = require('json5');

const program = new Command();
const pkgManager = new PackageManager();

program
  .name('continue_pkg')
  .description('A custom package manager')
  .version('1.0.0')
  .action(async () => {
    console.log('continue_pkg init');
    console.log('continue_pkg add <package>');
    console.log('continue_pkg install');
    console.log('continue_pkg install <package>');
  });

  program
  .command('install [package]')
  .description('Install a package or all packages from package.json if no package is specified')
  .action(async (pkg) => {
    if (pkg) {
      const [packageName, version] = pkg.split('@');
      const pkgVersion = version || 'latest';
      try {
        console.log(`Fetching package: ${packageName} details from npm...`);
        const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
        const resolvedVersion = pkgVersion === 'latest' ? response.data['dist-tags'].latest : pkgVersion;
        console.log(`Version of ${packageName} to be installed is ${resolvedVersion}`);
        await pkgManager.installPackage(packageName, resolvedVersion);
        console.log(`${packageName} installed successfully`);
      } catch (error) {
        console.error(`Failed to install package: ${error.message}`);
        console.error(error.stack);
      }
    } else {
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        let packageJson;
        try {
          packageJson = JSON5.parse(packageJsonContent);
        } catch (jsonError) {
          console.error(`Error parsing package.json:`, jsonError);
          console.error(`Content of package.json:`, packageJsonContent);
          return;
        }
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (Object.keys(dependencies).length === 0) {
          console.log('No dependencies found in package.json');
          return;
        }
        console.log('Installing all dependencies from package.json...');
        for (const [pkg, version] of Object.entries(dependencies)) {
          console.log(`Fetching package ${pkg} details from npm...`);
          const cleanVersion = semver.valid(semver.coerce(version));
          if (!cleanVersion) {
            console.warn(`Skipping invalid version for ${pkg}: ${version}`);
            continue;
          }
          await pkgManager.installPackage(pkg, cleanVersion, packageJson.devDependencies && pkg in packageJson.devDependencies);
        }
      } catch (error) {
        console.error(`Error installing packages:`, error);
        console.error(error.stack);
      }
    }
  });


  program
  .command('add <package>')
  .description('Add a package to package.json')
  .action(async (pkg) => {
    const [packageName, version] = pkg.split('@');
    const pkgVersion = version || 'latest';
    try {
      console.log(`Fetching package: ${packageName} details from npm...`);
      const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
      const resolvedVersion = pkgVersion === 'latest' ? response.data['dist-tags'].latest : pkgVersion;
      console.log(`Version of ${packageName} to be added is ${resolvedVersion}`);
      
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      packageJson.dependencies = packageJson.dependencies || {};
      packageJson.dependencies[packageName] = `^${resolvedVersion}`;
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
      
      await pkgManager.installPackage(packageName, resolvedVersion);
      console.log(`Added and installed ${packageName}@${resolvedVersion}`);
    } catch (error) {
      console.error(`Failed to add package: ${error.message}`);
    }
  });


  program
  .command('start')
  .description('Runs the script.start command from package.json')
  .action(async () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const startScript = packageJson.scripts && packageJson.scripts.start;

      if (!startScript) {
        console.error('No start script found in package.json');
        return;
      }

      const nodeModulesBinPath = path.resolve(process.cwd(), 'node_modules', '.bin');
      const env = { 
        ...process.env, 
        PATH: `${nodeModulesBinPath}${path.delimiter}${process.env.PATH}`,
        NODE_PATH: path.resolve(process.cwd(), 'node_modules')
      };

      const exec = require('child_process').exec;
      const child = exec(startScript, { env, shell: true });

      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);

      child.on('close', (code) => {
        console.log(`Child process exited with code ${code}`);
      });

    } catch (error) {
      console.error(`Failed to read or parse package.json: ${error.message}`);
    }
  });



program
  .command('init')
  .description('Initialize a new package.json file')
  .action(async () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const defaultPackageJson = {
      name: 'new-project',
      version: '1.0.0',
      description: '',
      main: 'index.js',
      scripts: {
        test: 'echo "Error: no test specified" && exit 1'
      },
      author: '',
      license: 'ISC',
      dependencies: {}
    };
    
    try {
      await fs.writeFile(packageJsonPath, JSON.stringify(defaultPackageJson, null, 2));
      console.log('Initialized a new package.json file');
    } catch (error) {
      console.error(`Failed to initialize package.json: ${error.message}`);
    }
  });

program.parse(process.argv);
