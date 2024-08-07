type EventCategory = string;
type EventName = string;

export type CountedEvent = {
  eventCategory: EventCategory;
  eventName: EventName;
  eventCount: number;
  eventTimestamps: number[];
  eventMessages: string[];
};

export type CountedEventMap = Map<EventCategory, Map<EventName, CountedEvent>>;
