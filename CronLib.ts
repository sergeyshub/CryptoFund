export default class CronLib {
    public static makeCronString(minutes: number): string {
        // Assuming it's not hours
        const cronString = `1/${minutes} * * * *`;

        // return '*/10 * * * * *'; // once every 10 seconds
        return cronString;
    }

    public static delay(ms: number) {
        return new Promise( resolve => setTimeout(resolve, ms) );
    }
}
