const axios = require('axios');
const path = require('path');
const tar = require('tar');
const fs = require('fs').promises;
const JSON5 = require('json5');
const semver = require('semver');

class PackageManager {

    constructor() {
        this.installedPackages = new Set();
    }

    async downloadAndExtractPackage(pkg, version) {
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
    
    async updatePackageLock(pkg, version) {
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
    
    
    async installPackage(pkg, version, isDevDependency = false) {
        const packageKey = `${pkg}@${version}`;
        if (this.installedPackages.has(packageKey)) {
            // console.log(`Package ${packageKey} is already installed. Skipping.`);
            return;
        }
    
        console.log(`Installing ${pkg}@${version}`);
        try {
            await this.downloadAndExtractPackage(pkg, version);
            await this.updatePackageLock(pkg, version);
    
            this.installedPackages.add(packageKey);
    
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
                await this.installPackage(depName, cleanVersion);
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
}

module.exports.PackageManager = PackageManager