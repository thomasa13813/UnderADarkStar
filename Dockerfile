# Use an official Node runtime as the base image
FROM node:18

# Add environment variable
ARG GAME_ENV=preprod
ENV GAME_ENV=$GAME_ENV

# Set the working directory in the container
WORKDIR /usr/src/app
# Copy package.json and package-lock.json
COPY package*.json ./
# Install dependencies
RUN npm install
# Copy the rest of the application code
COPY . .
# Build the client-side application
RUN npm run build-prod
# Expose the port the app runs on
EXPOSE 3000 9229
# Define the command to run the app
CMD ["npm", "run", "start:server"]