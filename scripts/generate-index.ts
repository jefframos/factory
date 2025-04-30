import { readdirSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function getGamesFolders(): string[] {
  const gamesPath = resolve(__dirname, '../games');
  return readdirSync(gamesPath).filter((file) => {
    const path = resolve(gamesPath, file);
    return statSync(path).isDirectory();
  });
}

function generateHTML(games: string[]) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Games Index</title>
</head>
<body>
  <h1>Games Index</h1>
  <ul>
    ${games.map(game => `<li><a href="./${game}/index.html">${game}</a></li>`).join('')}
  </ul>
</body>
</html>
`;
}

function generateIndex() {
  const games = getGamesFolders();
  const distPath = resolve(__dirname, '../dist');
  const html = generateHTML(games);
  writeFileSync(resolve(distPath, 'index.html'), html);
  console.log('✅ Games index generated!');
}

generateIndex();
