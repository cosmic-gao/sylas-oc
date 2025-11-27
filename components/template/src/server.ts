import { Server } from 'oc-server';

const userDatabase = [
  { name: 'John Doe', born: 1986, hobbies: ['Swimming', 'Basketball'] },
  { name: 'Jane Doe', born: 1991, hobbies: ['Running', 'Rugby'] },
];

const yearsFunFactDatabase: Record<number, string> = {
  1986: "Halley's Comet made its closest approach to Earth in 1986, visible to the naked eye.",
  1987: 'The first Final Fantasy game was released in 1987.',
  1991: 'The first web page was created in 1991 by Tim Berners-Lee.',
};

async function getUser(userId: number) {
  if (userId < 0 || userId >= userDatabase.length) {
    throw new Error(`User with ID ${userId} not found`);
  }
  return userDatabase[userId];
}

async function getFunFact(year: number) {
  return yearsFunFactDatabase[year] || `No fun fact available for year ${year}`;
}

// Export the server instance - this is required for OC
export const server = new Server({
  development: {
    // Enable console logs from browser to server for debugging
    console: true,
  },
})
  //Define URL parameters that can be passed to your component
  .withParameters({
    userId: {
      default: 1,
      description: 'The user id from the user database',
      example: 1,
      mandatory: true,
      type: 'number',
    },
  })
  // Main handler - returns initial data for component rendering
  // This runs when the component is first loaded
  .handler(async (params, ctx) => {
    const { userId } = params;
    const user = await getUser(userId);
    const [firstName, lastName] = user.name.split(/\s+/);

    if (firstName === 'Invalid') {
      // Return undefined to prevent rendering
      return;
    }

    // Set cache headers when same params produce same result
    // This improves performance by reducing server load
    // Don't cache in local environment because we might get render mismatches
    if (ctx.env.name !== 'local') {
      ctx.setHeader('Cache-Control', 'max-age=300'); // Cache for 5 minutes
    }

    // Return data that will be passed as props to React component
    return {
      firstName,
      lastName,
      born: user.born,
      hobbies: user.hobbies,
    };
  })
  // Actions are server endpoints that the client can call
  // Use these for user interactions, form submissions, etc.
  .action('funFact', async (params: { year: number }) => {
    const { year } = params;
    const funFact = await getFunFact(year);
    return {
      funFact,
    };
  });

// This enables automatic type inference between server and client
declare module 'oc-server' {
  interface Register {
    server: typeof server;
  }
}
