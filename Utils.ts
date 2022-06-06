export function getDateString(): string {
    return dateToString(new Date());
}

export function dateToString(date: Date): string {
    return date.toLocaleDateString() + ' ' + 
        date.toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute:'2-digit', second: '2-digit'});
}

export function numberToString(num: number, decimals: number): string {
    const options = { 
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals 
    };

    return num.toLocaleString('en', options);
}

export function round(num: number | null, decimals: number): number {
    if (num == null) return null;

    const mult = Math.pow(10, decimals);
    const rounded = Math.round(num * mult) / mult;

    return rounded;
}
