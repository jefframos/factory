# Flappy Bird with Open Game Protocol

A simple implementation of the classic Flappy Bird game with Open Game Protocol (OGP) integration for points tracking and rewards.

## Overview

This project demonstrates how to create a basic HTML5 canvas game with OGP integration. The game uses:

- HTML5 Canvas for rendering
- CSS for styling
- JavaScript for game logic
- Open Game Protocol SDK for points and rewards

## File Structure

- `index.html` - Main HTML file
- `style.css` - CSS styles for the game
- `game.js` - Game logic and OGP integration
- `icon.png` - Game icon (placeholder file, needs to be replaced with an actual PNG)

## Game Features

- Simple Flappy Bird mechanics
- Score tracking
- OGP points integration
- Responsive design
- Keyboard, mouse, and touch controls

## How to Play

1. Click the "Start" button to begin
2. Click/tap the screen or press the spacebar to make the bird jump
3. Navigate through the obstacles
4. Your score increases as you pass through obstacles
5. Game ends when you hit an obstacle or the ground/ceiling
6. Earned points are saved to your OGP account

## Development

The code has been structured for maintainability and readability:

- Configuration values are stored in the `CONFIG` object
- DOM elements are referenced in the `DOM` object
- Game state is managed in the `gameState` object
- OGP integration is handled by the `OGPManager` class
- Game logic is contained in the `FlappyBirdGame` class

## OGP Integration

The game uses the Open Game Protocol SDK to:

1. Initialize the OGP connection
2. Save player points after each game
3. Retrieve total accumulated points
4. Handle errors gracefully with fallbacks

## Requirements

- A modern web browser with HTML5 support
- Internet connection for OGP integration

## Setup

1. Replace the `icon.png` placeholder with an actual PNG image
2. Ensure the OGP SDK is properly loaded from the CDN
3. Update the OGP game ID and key if necessary

## License

This project is provided as-is for educational purposes. 