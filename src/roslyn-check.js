import { execSync } from 'child_process';
/**
 * Checks if roslyn-language-server is installed and executable
 */
export function checkRoslynLanguageServer() {
    try {
        execSync('which roslyn-language-server', { stdio: 'pipe' });
        return true;
    }
    catch (error) {
        return false;
    }
}
/**
 * Prints installation instructions if Roslyn Language Server is not found
 */
export function printInstallationInstructions() {
    console.error('ERROR: roslyn-language-server is not installed or not in PATH.');
    console.error('');
    console.error('Please install it by running:');
    console.error('  dotnet tool install --global roslyn-language-server --prerelease');
    console.error('');
}
