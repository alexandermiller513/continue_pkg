#!/usr/bin/env node
const { Command } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const tar = require('tar');
const semver = require('semver');
const JSON5 = require('json5');


const program = new Command();
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

  async function downloadAndExtractPackage(pkg, version) {
    const registryUrl = `https://registry.npmjs.org/${pkg}`;
    try {
        const registryResponse = await axios.get(registryUrl);
        const latestVersion = registryResponse.data['dist-tags'].latest;
        const versionToUse = version || latestVersion;

        let tarballUrl = ""

        if (registryResponse.data.versions[versionToUse] != null) {
            tarballUrl = registryResponse.data.versions[versionToUse].dist.tarball;
        } else {
            tarballUrl = registryResponse.data.versions[latestVersion].dist.tarball;
        }


        const response = await axios.get(tarballUrl, { responseType: 'arraybuffer' });
        
        // Create a valid path for the tarball
        const tarballDir = path.join(process.cwd(), 'node_modules', '.cache');
        const tarballPath = path.join(tarballDir, `${pkg.replace('/', '-')}-${versionToUse}.tgz`);
        
        // Ensure the directory exists
        await fs.mkdir(tarballDir, { recursive: true });
        
        await fs.writeFile(tarballPath, response.data);
        
        const extractPath = path.join(process.cwd(), 'node_modules', pkg);
        await fs.mkdir(extractPath, { recursive: true });
        await tar.extract({ file: tarballPath, cwd: extractPath, strip: 1 });
        await fs.unlink(tarballPath);

        console.log(`Successfully installed ${pkg}@${versionToUse}`);
    } catch (error) {
        console.error(`Error downloading or extracting ${pkg}@${version}:`, error);
        throw error;
    }
}

async function updatePackageLock(pkg, version) {
    const packageLockPath = path.resolve(process.cwd(), 'package-lock.json');
    let packageLock = {};

    try {
        const packageLockData = await fs.readFile(packageLockPath, 'utf-8');
        packageLock = JSON5.parse(packageLockData);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    packageLock.dependencies = packageLock.dependencies || {};
    packageLock.dependencies[pkg] = {
        version,
        resolved: `https://registry.npmjs.org/${pkg}/-/${pkg}-${version}.tgz`,
        integrity: '',
    };

    await fs.writeFile(packageLockPath, JSON.stringify(packageLock, null, 2));
}

const installedPackages = new Set();

async function installPackage(pkg, version, isDevDependency = false) {
    const packageKey = `${pkg}@${version}`;
    if (installedPackages.has(packageKey)) {
        // console.log(`Package ${packageKey} is already installed. Skipping.`);
        return;
    }

    console.log(`Installing ${pkg}@${version}`);
    try {
        await downloadAndExtractPackage(pkg, version);
        await updatePackageLock(pkg, version);

        installedPackages.add(packageKey);

        const packageJsonPath = path.join(process.cwd(), 'node_modules', pkg, 'package.json');
        let packageJson;
        try {
            const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
            packageJson = JSON5.parse(packageJsonContent);
        } catch (error) {
            console.error(`Error reading or parsing package.json for ${pkg}:`, error);
            console.error(`Content of ${packageJsonPath}:`, await fs.readFile(packageJsonPath, 'utf-8'));
            throw error;
        }

        // Install dependencies
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        for (const [depName, depVersion] of Object.entries(dependencies)) {
            const cleanVersion = semver.valid(semver.coerce(depVersion));
            if (!cleanVersion) {
                console.warn(`Skipping invalid version for ${depName}: ${depVersion}`);
                continue;
            }
            await installPackage(depName, cleanVersion);
        }

        // Handle bin scripts
        if (packageJson.bin) {
            const binFolder = path.join(process.cwd(), 'node_modules', '.bin');
            await fs.mkdir(binFolder, { recursive: true });

            const binEntries = typeof packageJson.bin === 'string' 
                ? { [pkg]: packageJson.bin } 
                : packageJson.bin;

            for (const [binName, binPath] of Object.entries(binEntries)) {
                const sourcePath = path.join(process.cwd(), 'node_modules', pkg, binPath);
                const targetPath = path.join(binFolder, binName);
                
                const shellScript = `#!/bin/sh
"${process.execPath}" "${sourcePath}" "$@"
`;
                await fs.writeFile(targetPath, shellScript);
                await fs.chmod(targetPath, '755'); // Make the script executable
            }
        }

        // Update main package.json
        const mainPackageJsonPath = path.resolve(process.cwd(), 'package.json');
        let mainPackageJson;
        try {
            const mainPackageJsonContent = await fs.readFile(mainPackageJsonPath, 'utf-8');
            mainPackageJson = JSON.parse(mainPackageJsonContent);
        } catch (error) {
            console.error(`Error reading or parsing main package.json:`, error);
            console.error(`Content of ${mainPackageJsonPath}:`, await fs.readFile(mainPackageJsonPath, 'utf-8'));
            throw error;
        }

        if (isDevDependency) {
            mainPackageJson.devDependencies = mainPackageJson.devDependencies || {};
            mainPackageJson.devDependencies[pkg] = `^${version}`;
        } else {
            mainPackageJson.dependencies = mainPackageJson.dependencies || {};
            mainPackageJson.dependencies[pkg] = `^${version}`;
        }
        // await fs.writeFile(mainPackageJsonPath, JSON.stringify(mainPackageJson, null, 2));

    } catch (error) {
        console.error(`Error installing package ${pkg}@${version}:`, error);
        throw error;
    }
}

program
  .command('install [package]')
  .description('Install a package or all packages from package.json if no package is specified')
  .action(async (pkg) => {
    if (pkg) {
      try {
        console.log(`Fetching package: ${pkg} details from npm...`);
        const response = await axios.get(`https://registry.npmjs.org/${pkg}`);
        const latestVersion = response.data['dist-tags'].latest;
        console.log(`Latest version of ${pkg} is ${latestVersion}`);
        await installPackage(pkg, latestVersion);
        console.log(`${pkg} installed successfully`);
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
          await installPackage(pkg, cleanVersion, packageJson.devDependencies && pkg in packageJson.devDependencies);
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
    try {
      // console.log(`Fetching package: ${pkg} details from npm...`);
      const response = await axios.get(`https://registry.npmjs.org/${pkg}`);
      const latestVersion = response.data['dist-tags'].latest;
      // console.log(`Latest version of ${pkg} is ${latestVersion}`);
      
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      packageJson.dependencies = packageJson.dependencies || {};
      packageJson.dependencies[pkg] = `^${latestVersion}`;
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
      
    //   await installPackage(pkg, latestVersion);
      console.log(`Added ${pkg}@${latestVersion}`);
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
