// Sample notes for the demo and for first-time users (English, 300-600
// words each). The "Load sample" buttons in the UI create a note from one
// of these. The same texts are also exported as Markdown seed files in
// `samples/` (run `npm run export:samples` to regenerate them from here —
// this file is the single source of truth).

export interface SampleNote {
  id: string;
  title: string;
  subject: string;
  content: string;
}

export const SAMPLE_NOTES: SampleNote[] = [
  {
    id: 'photosynthesis',
    title: 'Photosynthesis — sample note',
    subject: 'Biology',
    content: `Photosynthesis

Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy stored in glucose. It takes place mainly in the chloroplasts of leaf cells, using the pigment chlorophyll to capture sunlight. Chlorophyll absorbs mostly blue and red light and reflects green light, which is why most leaves look green.

The overall equation is: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. Carbon dioxide enters the leaf through tiny pores called stomata, while water is absorbed by the roots and transported up through the xylem to the leaves. Oxygen, a byproduct of the process, is released back into the air through the stomata.

Photosynthesis has two stages. The light-dependent reactions take place in the thylakoid membranes of the chloroplast. There, sunlight splits water molecules, releasing oxygen, and the energy is stored as ATP and NADPH. The second stage, the Calvin cycle, or light-independent reactions, takes place in the stroma. It uses ATP and NADPH to fix carbon dioxide into glucose and other sugars that the plant can use for growth or store as starch.

Several factors affect the rate of photosynthesis. Light intensity matters: more light speeds up the process up to a saturation point. Carbon dioxide concentration matters too, because CO2 is a raw material. Temperature also matters, since the enzymes of the Calvin cycle work best in a moderate range; too much heat can damage them. If any one of these is too low, it becomes the limiting factor and the rate cannot increase, no matter how much of the others is available.

Farmers use this knowledge in greenhouses. They add extra artificial light, pump in additional carbon dioxide, and control the temperature to push photosynthesis faster and increase crop yields. Understanding photosynthesis also matters for the whole planet: it produces nearly all of the oxygen in the atmosphere and forms the base of almost every food chain on Earth.`,
  },
  {
    id: 'newtons-laws',
    title: "Newton's Laws of Motion — sample note",
    subject: 'Physics',
    content: `Newton's Laws of Motion

In 1687, Isaac Newton published three laws of motion in his book Principia. Together, they describe how forces affect the movement of objects, and they still form the foundation of classical mechanics more than three centuries later.

Newton's First Law, the law of inertia, states that an object at rest stays at rest and an object in motion stays in motion at a constant speed in a straight line, unless acted on by an unbalanced force. Inertia is the tendency of an object to resist changes in its motion, and it depends on mass: a heavy truck is much harder to start or stop than a bicycle. This is why seatbelts matter — when a car stops suddenly, your body keeps moving forward at the car's previous speed until the belt applies a force to stop you.

Newton's Second Law states that the acceleration of an object is directly proportional to the net force acting on it and inversely proportional to its mass. It is usually written as F = ma, force equals mass times acceleration. Pushing a shopping cart shows this clearly: the same push accelerates an empty cart much more than a full one, and a harder push accelerates the same cart more. The law also tells us the direction of the acceleration: it always points in the same direction as the net force. Engineers use F = ma to calculate everything from the thrust a rocket needs to lift off to the braking force a car needs to stop in time.

Newton's Third Law states that for every action there is an equal and opposite reaction. When you push against a wall, the wall pushes back on you with exactly the same force. A rocket works by this principle: it expels hot gas downward at high speed, and the gas pushes the rocket upward with an equal and opposite force. The two forces in a third-law pair always act on different objects, so they never cancel each other out — the gas pushes the rocket, and the rocket pushes the gas.

The three laws only work well at everyday speeds and sizes. At speeds close to the speed of light, or at the scale of atoms, physicists must use relativity or quantum mechanics instead. But for cars, bridges, sports, and spaceflight within the solar system, Newton's laws remain the practical tools engineers reach for first.`,
  },
  {
    id: 'french-revolution',
    title: 'The French Revolution — sample note',
    subject: 'History',
    content: `The French Revolution

The French Revolution began in 1789 and transformed France from a monarchy ruled by a king into a republic, changing the course of European history. Its causes were a mix of inequality, debt, and new ideas.

French society was divided into three Estates. The First Estate was the clergy and the Second Estate was the nobility; together they made up less than three percent of the population but owned much of the land and paid almost no taxes. The Third Estate, everyone else — peasants, workers, and the middle class — paid nearly all of the taxes. Meanwhile, King Louis XVI had spent huge sums supporting the American Revolution and on the royal court, leaving the state nearly bankrupt. When bad harvests in 1788 pushed bread prices to record highs, ordinary people went hungry while the privileged few kept their exemptions.

In the summer of 1789 the crisis broke open. The Third Estate declared itself the National Assembly and, after the king locked them out of their meeting hall, its deputies swore the Tennis Court Oath, promising not to disband until France had a constitution. On 14 July 1789, a crowd in Paris stormed the Bastille, a royal prison and symbol of the king's power. Weeks later the Assembly passed the Declaration of the Rights of Man and of the Citizen, proclaiming that all men are born free and equal in rights, with liberty, property, security, and resistance to oppression.

The revolution then turned radical. In 1792 France became a republic and the king was tried and executed the following year. The Committee of Public Safety, led by Maximilien Robespierre, launched the Reign of Terror in 1793-1794, executing thousands of suspected enemies of the revolution by guillotine, including Robespierre himself when the Terror finally consumed its own leaders. In 1799, a young general named Napoleon Bonaparte seized power in a coup, ending the revolutionary government while keeping many of its reforms.

The revolution's legacy lasted far beyond France. It spread the ideas of liberty, equality, and nationalism across Europe, inspired the Napoleonic Code that still shapes law in many countries, and showed that ordinary people could overthrow a centuries-old monarchy. Its violence also became a warning: revolutions that begin with ideals of freedom can slide into terror when fear and faction take over.`,
  },
];

export function getSampleNote(id: string): SampleNote | undefined {
  return SAMPLE_NOTES.find((s) => s.id === id);
}
