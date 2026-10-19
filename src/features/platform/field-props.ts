/** The DS `Field` render props as `Input` attributes (`describedBy` is not a DOM attribute). */
export function inputProps(props: { id: string; describedBy?: string; invalid: boolean }) {
  return { id: props.id, 'aria-describedby': props.describedBy, invalid: props.invalid };
}
